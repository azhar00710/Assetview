import base64
import os
import tempfile
from threading import Lock

import fitz
import torch
from fastapi import FastAPI, HTTPException, Request
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

app = FastAPI(title="AssetView Florence OCR Service", version="1.0.0")

_model = None
_processor = None
_lock = Lock()
Image.MAX_IMAGE_PIXELS = None


def require_api_key(request: Request):
  configured = os.getenv("FLORENCE_OCR_API_KEY", "").strip()
  if not configured:
    return
  provided = (
    request.headers.get("x-api-key")
    or request.headers.get("X-API-Key")
    or request.headers.get("authorization", "").replace("Bearer ", "")
  ).strip()
  if provided != configured:
    raise HTTPException(status_code=401, detail="Invalid API key")


def get_runtime():
  global _model, _processor
  if _model is None or _processor is None:
    with _lock:
      if _model is None or _processor is None:
        model_name = os.getenv("FLORENCE_MODEL_ID", "microsoft/Florence-2-base-ft")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32

        _processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
        _model = AutoModelForCausalLM.from_pretrained(
          model_name,
          torch_dtype=dtype,
          trust_remote_code=True,
        ).to(device).eval()
  return _model, _processor


def _quad_to_points(quad):
  pts = []
  if isinstance(quad, list) and len(quad) == 8:
    pts = [
      {"x": int(quad[0]), "y": int(quad[1])},
      {"x": int(quad[2]), "y": int(quad[3])},
      {"x": int(quad[4]), "y": int(quad[5])},
      {"x": int(quad[6]), "y": int(quad[7])},
    ]
  elif isinstance(quad, list) and len(quad) == 4 and isinstance(quad[0], list):
    pts = [{"x": int(p[0]), "y": int(p[1])} for p in quad[:4]]
  return pts


def _clean_text(value):
  t = str(value or "").strip()
  # Remove common generation artifacts from seq2seq decoding.
  t = t.replace("<s>", "").replace("</s>", "").replace("<pad>", "").strip()
  return t


def _run_ocr_on_image(image):
  model, processor = get_runtime()
  device = model.device
  task_prompt = "<OCR_WITH_REGION>"
  max_new_tokens = int(os.getenv("FLORENCE_MAX_NEW_TOKENS", "768"))

  inputs = processor(text=task_prompt, images=image, return_tensors="pt")
  inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}

  generated_ids = model.generate(
    input_ids=inputs.get("input_ids"),
    pixel_values=inputs.get("pixel_values"),
    max_new_tokens=max_new_tokens,
    num_beams=1,
    do_sample=False,
  )
  generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
  parsed = processor.post_process_generation(
    generated_text,
    task=task_prompt,
    image_size=(image.width, image.height),
  )

  payload = parsed.get(task_prompt, parsed) if isinstance(parsed, dict) else {}
  labels = payload.get("labels", []) if isinstance(payload, dict) else []
  quads = (
    payload.get("quad_boxes", [])
    or payload.get("boxes", [])
    or payload.get("bboxes", [])
    if isinstance(payload, dict) else []
  )

  words = []
  for i, text in enumerate(labels):
    t = _clean_text(text)
    if not t:
      continue
    box = quads[i] if i < len(quads) else None
    words.append({
      "text": t,
      "score": 0.85,
      "quad_box": _quad_to_points(box),
    })

  # Remove obvious artifact tokens (single punctuation or raw tag markers)
  words = [w for w in words if len(w["text"]) > 1 and "<" not in w["text"] and ">" not in w["text"]]

  return words


def _dedupe_words(words):
  seen = set()
  out = []
  for w in words:
    quad = w.get("quad_box") or []
    if quad:
      cx = int(sum([p["x"] for p in quad]) / len(quad))
      cy = int(sum([p["y"] for p in quad]) / len(quad))
    else:
      cx, cy = 0, 0
    key = (w["text"].upper(), cx // 8, cy // 8)
    if key in seen:
      continue
    seen.add(key)
    out.append(w)
  return out


def _run_ocr(image_path):
  image = Image.open(image_path).convert("RGB")
  w, h = image.width, image.height

  tile_size = int(os.getenv("FLORENCE_TILE_SIZE", "2048"))
  tile_overlap = int(os.getenv("FLORENCE_TILE_OVERLAP", "256"))
  stride = max(256, tile_size - tile_overlap)

  all_words = []
  if max(w, h) <= tile_size:
    all_words = _run_ocr_on_image(image)
  else:
    for y in range(0, h, stride):
      for x in range(0, w, stride):
        x2 = min(w, x + tile_size)
        y2 = min(h, y + tile_size)
        tile = image.crop((x, y, x2, y2))
        tile_words = _run_ocr_on_image(tile)
        for tw in tile_words:
          quad = tw.get("quad_box") or []
          if quad:
            tw["quad_box"] = [{"x": p["x"] + x, "y": p["y"] + y} for p in quad]
          all_words.append(tw)

  words = _dedupe_words(all_words)
  return {
    "words": words,
    "full_text": "\n".join([w["text"] for w in words]),
    "page_width": int(w),
    "page_height": int(h),
  }


@app.get("/health")
def health():
  return {"status": "ok", "service": "florence-ocr"}


@app.post("/ocr")
async def ocr(request: Request):
  require_api_key(request)
  body = await request.json()
  image_b64 = body.get("image_base64")
  pdf_b64 = body.get("pdf_base64")

  if not image_b64 and not pdf_b64:
    raise HTTPException(status_code=400, detail="image_base64 or pdf_base64 is required")

  image_bytes = None

  if image_b64:
    try:
      image_bytes = base64.b64decode(image_b64, validate=True)
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc
  else:
    try:
      pdf_bytes = base64.b64decode(pdf_b64, validate=True)
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"Invalid base64 PDF: {exc}") from exc

    page_index = int(body.get("pdf_page", 0) or 0)
    render_dpi = int(body.get("render_dpi", 300) or 300)
    if page_index < 0:
      page_index = 0
    if render_dpi < 72:
      render_dpi = 72

    try:
      doc = fitz.open(stream=pdf_bytes, filetype="pdf")
      if doc.page_count < 1:
        raise HTTPException(status_code=400, detail="PDF has no pages")
      if page_index >= doc.page_count:
        page_index = 0
      page = doc.load_page(page_index)
      pix = page.get_pixmap(dpi=render_dpi, alpha=False)
      image_bytes = pix.tobytes("png")
      doc.close()
    except HTTPException:
      raise
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"PDF render failed: {exc}") from exc

  with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
    tmp.write(image_bytes)
    tmp_path = tmp.name

  try:
    return _run_ocr(tmp_path)
  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Florence OCR inference failed: {exc}") from exc
  finally:
    try:
      os.remove(tmp_path)
    except OSError:
      pass

