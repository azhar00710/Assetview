import sharp from 'sharp';

function clampConfidence(value, fallback = 0.8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toPoint(pt) {
  if (Array.isArray(pt) && pt.length >= 2) {
    return { x: Number(pt[0]) || 0, y: Number(pt[1]) || 0 };
  }
  if (pt && typeof pt === 'object') {
    return { x: Number(pt.x) || 0, y: Number(pt.y) || 0 };
  }
  return null;
}

function normalizeVertices(box) {
  if (!box) return [];
  if (Array.isArray(box)) {
    const pts = box.map(toPoint).filter(Boolean);
    if (pts.length >= 4) return pts.slice(0, 4);
    if (pts.length === 2) {
      const [a, b] = pts;
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ];
    }
  }
  if (typeof box === 'object') {
    const x = Number(box.x ?? box.left ?? 0) || 0;
    const y = Number(box.y ?? box.top ?? 0) || 0;
    const w = Number(box.w ?? box.width ?? 0) || 0;
    const h = Number(box.h ?? box.height ?? 0) || 0;
    if (w > 0 && h > 0) {
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    }
  }
  return [];
}

function flattenDetections(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (!item) continue;
    if (Array.isArray(item) && item.length === 2 && Array.isArray(item[0])) {
      out.push(item);
      continue;
    }
    if (Array.isArray(item) && item.length > 0 && Array.isArray(item[0])) {
      out.push(...flattenDetections(item));
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * PaddleOCR provider via HTTP endpoint.
 * Expected to return text + geometry, normalized to the project OCR contract:
 * { words, fullText, pageWidth, pageHeight }.
 */
export default class PaddleOCRProvider {
  constructor(options = {}) {
    this._endpointUrl = options.endpointUrl || process.env.PADDLE_OCR_URL || '';
    this._apiKey = options.apiKey || process.env.PADDLE_OCR_API_KEY || '';
    this._timeoutMs = Number(options.timeoutMs || process.env.PADDLE_OCR_TIMEOUT_MS || 120000);
  }

  async extractFromImage(imageBuffer) {
    if (!this._endpointUrl) {
      throw new Error('PADDLE_OCR_URL is not configured');
    }
    const meta = await sharp(imageBuffer).metadata();
    const pageWidth = meta.width || 0;
    const pageHeight = meta.height || 0;

    const payload = {
      image_base64: imageBuffer.toString('base64'),
      return_polygons: true,
      return_confidence: true,
    };

    const data = await this._call(payload);
    return this._parseResponse(data, { pageWidth, pageHeight });
  }

  async extractFromPdf(pdfBuffer) {
    if (!this._endpointUrl) {
      throw new Error('PADDLE_OCR_URL is not configured');
    }

    const renderDpi = Math.max(
      150,
      Number(process.env.OCR_PADDLE_PDF_DENSITY || process.env.AI_ANNOTATE_PDF_DENSITY || 300)
    );
    const payload = {
      pdf_base64: pdfBuffer.toString('base64'),
      pdf_page: 0,
      render_dpi: renderDpi,
      return_polygons: true,
      return_confidence: true,
    };

    const data = await this._call(payload);
    const pageWidth = Number(data?.page_width) || 0;
    const pageHeight = Number(data?.page_height) || 0;
    return this._parseResponse(data, { pageWidth, pageHeight });
  }

  async _call(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this._apiKey) {
        headers.Authorization = `Bearer ${this._apiKey}`;
        headers['x-api-key'] = this._apiKey;
      }
      const res = await fetch(this._endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Paddle OCR request failed (${res.status}): ${txt}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  _parseResponse(data, { pageWidth, pageHeight }) {
    const rawDetections = flattenDetections(
      data?.results
      || data?.detections
      || data?.data
      || data?.result
      || data
    );

    const words = rawDetections.map((item) => {
      // Canonical Paddle format: [box, [text, score]]
      if (Array.isArray(item) && item.length >= 2) {
        const vertices = normalizeVertices(item[0]);
        const rec = item[1];
        const text = Array.isArray(rec) ? String(rec[0] || '') : String(item?.text || '');
        const score = Array.isArray(rec) ? clampConfidence(rec[1], 0.8) : clampConfidence(item?.score, 0.8);
        return { text: text.trim(), confidence: score, vertices, pageWidth, pageHeight };
      }

      // Generic object format: { text, score, box|bbox|polygon|points }
      const text = String(item?.text || item?.label || item?.transcription || '').trim();
      const score = clampConfidence(item?.score ?? item?.confidence, 0.8);
      const vertices = normalizeVertices(item?.box || item?.bbox || item?.polygon || item?.points);
      return { text, confidence: score, vertices, pageWidth, pageHeight };
    }).filter(w => w.text.length > 0);

    const fullText = words.map(w => w.text).join('\n');
    return { words, fullText, pageWidth, pageHeight };
  }
}
