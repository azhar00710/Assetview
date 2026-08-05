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

/**
 * Florence OCR provider via HTTP endpoint.
 * Expected response from microservice:
 * { words: [{text, score|confidence, box|bbox|polygon|quad_box}], full_text, page_width, page_height }.
 */
export default class FlorenceOCRProvider {
  constructor(options = {}) {
    this._endpointUrl = options.endpointUrl || process.env.FLORENCE_OCR_URL || '';
    this._apiKey = options.apiKey || process.env.FLORENCE_OCR_API_KEY || '';
    this._timeoutMs = Number(options.timeoutMs || process.env.FLORENCE_OCR_TIMEOUT_MS || 600000);
  }

  async extractFromImage(imageBuffer) {
    if (!this._endpointUrl) {
      throw new Error('FLORENCE_OCR_URL is not configured');
    }
    const payload = {
      image_base64: imageBuffer.toString('base64'),
      return_polygons: true,
      return_confidence: true,
    };
    const data = await this._call(payload);
    return this._parseResponse(data);
  }

  async extractFromPdf(pdfBuffer) {
    if (!this._endpointUrl) {
      throw new Error('FLORENCE_OCR_URL is not configured');
    }
    const renderDpi = Math.max(
      150,
      Number(process.env.OCR_FLORENCE_PDF_DENSITY || process.env.AI_ANNOTATE_PDF_DENSITY || 220)
    );
    const payload = {
      pdf_base64: pdfBuffer.toString('base64'),
      pdf_page: 0,
      render_dpi: renderDpi,
      return_polygons: true,
      return_confidence: true,
    };
    const data = await this._call(payload);
    return this._parseResponse(data);
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
        throw new Error(`Florence OCR request failed (${res.status}): ${txt}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  _parseResponse(data) {
    const pageWidth = Number(data?.page_width || data?.pageWidth || 0) || 0;
    const pageHeight = Number(data?.page_height || data?.pageHeight || 0) || 0;
    const wordsRaw = Array.isArray(data?.words) ? data.words : [];

    const words = wordsRaw.map((w) => {
      const text = String(w?.text || w?.label || '').trim();
      const confidence = clampConfidence(w?.score ?? w?.confidence, 0.8);
      const vertices = normalizeVertices(w?.box || w?.bbox || w?.polygon || w?.quad_box || w?.quadBox || w?.points);
      return {
        text,
        confidence,
        vertices,
        pageWidth,
        pageHeight,
      };
    }).filter(w => w.text.length > 0);

    const fullText = String(data?.full_text || data?.fullText || words.map(w => w.text).join('\n'));
    return { words, fullText, pageWidth, pageHeight };
  }
}

