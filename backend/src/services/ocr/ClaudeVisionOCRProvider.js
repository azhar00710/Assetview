/**
 * Claude Vision OCR Provider.
 * Uses Claude's vision capabilities to extract text and tag candidates from P&ID drawings.
 * Can process both raster images (PNG, JPEG, TIFF) and PDFs directly.
 *
 * Returns the same { words, fullText, pageWidth, pageHeight } format as VisionOCRProvider
 * so it can be used as a drop-in replacement in the OCR pipeline.
 */

const SUPPORTED_IMAGE_TYPES = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

const EXTRACTION_PROMPT = `You are analyzing a P&ID (Piping and Instrumentation Diagram) engineering drawing. Extract ALL text visible in this drawing.

Focus especially on:
1. **Equipment tags** — e.g., V-101, P-201A, E-301, T-100, C-150, HX-200, TK-500
2. **Instrument tags** — e.g., FIC-101, LT-201, PSV-301, TI-100, PCV-200, FE-150
3. **Line numbers** — e.g., 6"-P-101-A1A-HC, 3"-FW-201-B2B, 2"-IA-050
4. **Valve tags** — e.g., XV-101, HV-200, CV-301, BV-100
5. **Drawing references** — drawing numbers, revision numbers, sheet references
6. **Notes and labels** — any other readable text

For EACH text item found, provide:
- The exact text as read
- An approximate bounding box as percentage of image dimensions (0-100 scale)
- A confidence score (0.0 to 1.0)
- A type classification: "equipment", "instrument", "line", "valve", "note", or "unknown"

Respond with ONLY valid JSON in this exact format:
{
  "fullText": "all visible text concatenated with newlines",
  "imageWidth": <estimated width in pixels if visible, else 2400>,
  "imageHeight": <estimated height in pixels if visible, else 1700>,
  "items": [
    {
      "text": "V-101",
      "type": "equipment",
      "confidence": 0.95,
      "bbox": { "x_pct": 25.5, "y_pct": 30.2, "w_pct": 5.0, "h_pct": 2.5 }
    }
  ]
}

Extract EVERY piece of readable text. Do not skip anything. Be thorough — a missed tag is worse than a false positive.`;

export default class ClaudeVisionOCRProvider {
  /**
   * @param {string} apiKey - Anthropic API key
   * @param {object} [options]
   * @param {string} [options.model] - Claude model to use (default: claude-sonnet-4-20250514)
   * @param {number} [options.timeoutMs] - Timeout per API call in ms (default: 300000 = 5 min)
   */
  constructor(apiKey, options = {}) {
    this._apiKey = apiKey;
    this._model = options.model || 'claude-sonnet-4-20250514';
    this._timeoutMs = options.timeoutMs || 300000; // 5 minutes
    this._client = null;
  }

  async _getClient() {
    if (this._client) return this._client;
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      if (!this._apiKey || typeof this._apiKey !== 'string') {
        throw new Error('Invalid or missing Claude API key');
      }
      this._client = new Anthropic({ apiKey: this._apiKey });
      return this._client;
    } catch (err) {
      if (err.message?.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
      }
      throw err;
    }
  }

  /**
   * Extract text from an image buffer (PNG, JPEG, GIF, WEBP).
   * @param {Buffer} imageBuffer
   * @param {string} [mimeType] - If known; otherwise auto-detected
   * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number }>}
   */
  async extractFromImage(imageBuffer, mimeType) {
    const detectedType = mimeType || this._detectMimeType(imageBuffer);
    if (!SUPPORTED_IMAGE_TYPES[detectedType]) {
      throw new Error(`Unsupported image type: ${detectedType}. Supported: ${Object.keys(SUPPORTED_IMAGE_TYPES).join(', ')}`);
    }

    const client = await this._getClient();
    const base64 = imageBuffer.toString('base64');

    console.log(`[ClaudeVision] Processing image (${detectedType}, ${Math.round(imageBuffer.length / 1024)}KB) with ${this._model}`);

    const response = await this._callWithTimeout(client.messages.create({
      model: this._model,
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: detectedType, data: base64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    }));

    return this._parseClaudeResponse(response);
  }

  /**
   * Extract text from a PDF buffer. Claude can process PDFs directly.
   * @param {Buffer} pdfBuffer - The raw PDF file content
   * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number }>}
   */
  async extractFromPdf(pdfBuffer) {
    const client = await this._getClient();
    const base64 = pdfBuffer.toString('base64');

    console.log(`[ClaudeVision] Processing PDF (${Math.round(pdfBuffer.length / 1024)}KB) with ${this._model}`);

    const response = await this._callWithTimeout(client.messages.create({
      model: this._model,
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    }));

    return this._parseClaudeResponse(response);
  }

  /**
   * Parse Claude's JSON response into the standard words array format.
   * @param {object} response - Claude API response
   * @returns {{ words: Array, fullText: string, pageWidth: number, pageHeight: number }}
   */
  _parseClaudeResponse(response) {
    const textBlock = response.content?.find(b => b.type === 'text');
    if (!textBlock?.text) {
      console.warn('[ClaudeVision] No text response from Claude');
      return { words: [], fullText: '', pageWidth: 0, pageHeight: 0 };
    }

    let parsed;
    try {
      // Extract JSON from response (Claude may wrap it in markdown code blocks)
      let jsonStr = textBlock.text.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      console.error('[ClaudeVision] Failed to parse Claude response as JSON:', err.message);
      console.error('[ClaudeVision] Raw response:', textBlock.text.substring(0, 500));
      return { words: [], fullText: textBlock.text, pageWidth: 0, pageHeight: 0 };
    }

    const pageWidth = parsed.imageWidth || 2400;
    const pageHeight = parsed.imageHeight || 1700;
    const items = parsed.items || [];

    console.log(`[ClaudeVision] Extracted ${items.length} items, fullText ${(parsed.fullText || '').length} chars`);

    // Convert Claude's response to the words[] format expected by WordGrouper
    const words = items.map(item => {
      const bbox = item.bbox || {};
      // Convert percentage-based bbox to pixel vertices (4 corners)
      const x = (bbox.x_pct || 0) / 100 * pageWidth;
      const y = (bbox.y_pct || 0) / 100 * pageHeight;
      const w = (bbox.w_pct || 5) / 100 * pageWidth;
      const h = (bbox.h_pct || 2) / 100 * pageHeight;

      return {
        text: (item.text || '').trim(),
        confidence: item.confidence || 0.8,
        vertices: [
          { x: Math.round(x), y: Math.round(y) },
          { x: Math.round(x + w), y: Math.round(y) },
          { x: Math.round(x + w), y: Math.round(y + h) },
          { x: Math.round(x), y: Math.round(y + h) },
        ],
        pageWidth,
        pageHeight,
        // Extra metadata from Claude's classification
        claudeType: item.type || 'unknown',
      };
    });

    return {
      words,
      fullText: parsed.fullText || items.map(i => i.text).join('\n'),
      pageWidth,
      pageHeight,
    };
  }

  /**
   * Wrap a promise with a timeout to prevent hanging on large files.
   */
  async _callWithTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Claude Vision API call timed out after ${this._timeoutMs / 1000}s`)), this._timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Auto-detect MIME type from buffer magic bytes.
   */
  _detectMimeType(buffer) {
    if (!buffer || buffer.length < 4) return 'image/png';
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
    // GIF: 47 49 46
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
    // WEBP: 52 49 46 46 ... 57 45 42 50
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    // PDF: 25 50 44 46
    if (buffer[0] === 0x25 && buffer[1] === 0x50) return 'application/pdf';
    return 'image/png'; // default
  }

  /**
   * Check if a buffer is a PDF.
   */
  _isPdf(buffer) {
    return buffer && buffer.length > 4 && buffer.slice(0, 5).toString() === '%PDF-';
  }
}
