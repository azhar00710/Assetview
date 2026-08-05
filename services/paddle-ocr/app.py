import base64
import os
import tempfile
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
import fitz
from paddleocr import PaddleOCR

app = FastAPI(title="AssetView Paddle OCR Service", version="1.0.0")

_ocr = None
_lock = Lock()


def get_ocr():
  global _ocr
  if _ocr is None:
    with _lock:
      if _ocr is None:
        _ocr = PaddleOCR(
          use_angle_cls=True,
          lang=os.getenv("PADDLE_OCR_LANG", "en"),
          show_log=False,
        )
  return _ocr


def require_api_key(request: Request):
  configured = os.getenv("PADDLE_OCR_API_KEY", "").strip()
  if not configured:
    return
  provided = (
    request.headers.get("x-api-key")
    or request.headers.get("X-API-Key")
    or request.headers.get("authorization", "").replace("Bearer ", "")
  ).strip()
  if provided != configured:
    raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
def health():
  return {"status": "ok", "service": "paddle-ocr"}


@app.post("/ocr")
async def ocr(request: Request):
  require_api_key(request)
  body = await request.json()
  image_b64 = body.get("image_base64")
  pdf_b64 = body.get("pdf_base64")

  if not image_b64 and not pdf_b64:
    raise HTTPException(status_code=400, detail="image_base64 or pdf_base64 is required")

  image_bytes = None
  page_width = None
  page_height = None

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
      page_width = int(pix.width)
      page_height = int(pix.height)
      doc.close()
    except HTTPException:
      raise
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"PDF render failed: {exc}") from exc

  with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
    tmp.write(image_bytes)
    tmp_path = tmp.name

  try:
    result = get_ocr().ocr(tmp_path, cls=True)
    # Keep shape close to what backend provider already normalizes.
    return {"results": result, "page_width": page_width, "page_height": page_height}
  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Paddle OCR inference failed: {exc}") from exc
  finally:
    try:
      os.remove(tmp_path)
    except OSError:
      pass
