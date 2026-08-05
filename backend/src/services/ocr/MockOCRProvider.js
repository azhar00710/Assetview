/**
 * Mock OCR provider for testing without Google Cloud Vision.
 * Generates realistic P&ID tag extractions using actual entities from the database.
 * Activated automatically when @google-cloud/vision is not installed.
 */

export default class MockOCRProvider {
  constructor(prisma, pnidId) {
    this._prisma = prisma;
    this._pnidId = pnidId;
  }

  /**
   * Generate mock OCR results based on actual entities linked to this P&ID.
   * Produces realistic bounding boxes spread across the drawing area.
   */
  async extractFromImage(_imageBuffer) {
    const pageWidth = 2400;
    const pageHeight = 1600;

    // Get equipment on this P&ID (via pnid_equipment or pnid_system → equipment)
    const equipment = await this._prisma.$queryRaw`
      SELECT DISTINCT e.tag, pe.annotation_x_pct, pe.annotation_y_pct
      FROM equipment e
      JOIN pnid_system ps ON ps.system_id = e.system_id
      LEFT JOIN pnid_equipment pe ON pe.equipment_id = e.id AND pe.pnid_id = ${this._pnidId}::uuid
      WHERE ps.pnid_id = ${this._pnidId}::uuid AND e.deleted_at IS NULL
    `;

    // Get instruments on this P&ID
    const instruments = await this._prisma.$queryRaw`
      SELECT DISTINCT i.tag, pi.annotation_x_pct, pi.annotation_y_pct
      FROM instrument i
      JOIN pnid_system ps ON ps.system_id = i.system_id
      LEFT JOIN pnid_instrument pi ON pi.instrument_id = i.id AND pi.pnid_id = ${this._pnidId}::uuid
      WHERE ps.pnid_id = ${this._pnidId}::uuid AND i.deleted_at IS NULL
    `;

    // Get lines on this P&ID
    const lines = await this._prisma.$queryRaw`
      SELECT DISTINCT l.line_number
      FROM line l
      JOIN pnid_line pl ON pl.line_id = l.id
      WHERE pl.pnid_id = ${this._pnidId}::uuid AND l.deleted_at IS NULL
    `;

    const words = [];
    let yOffset = 0.08; // Start from 8% down

    // Generate words for equipment tags
    for (const eq of equipment) {
      const xPct = eq.annotation_x_pct || (0.1 + Math.random() * 0.7);
      const yPct = eq.annotation_y_pct || yOffset;
      words.push(this._makeWord(eq.tag, xPct / 100 * pageWidth, yPct / 100 * pageHeight, pageWidth, pageHeight));
      yOffset += 0.06;
    }

    // Generate words for instrument tags
    for (const inst of instruments) {
      const xPct = inst.annotation_x_pct || (0.15 + Math.random() * 0.6);
      const yPct = inst.annotation_y_pct || yOffset;
      words.push(this._makeWord(inst.tag, xPct / 100 * pageWidth, yPct / 100 * pageHeight, pageWidth, pageHeight));
      yOffset += 0.05;
    }

    // Generate words for line numbers
    for (const line of lines) {
      const x = (0.05 + Math.random() * 0.8) * pageWidth;
      const y = yOffset * pageHeight;
      words.push(this._makeWord(line.line_number, x, y, pageWidth, pageHeight));
      yOffset += 0.05;
    }

    // Add some noise words that won't classify as tags (to simulate real OCR)
    const noiseWords = ['NOTES', 'REV', 'DATE', 'DWG', 'ISSUED', 'FOR', 'APPROVAL', 'SCALE', '1:50'];
    for (const nw of noiseWords) {
      words.push(this._makeWord(nw, Math.random() * pageWidth * 0.8 + 100, Math.random() * pageHeight * 0.8 + 50, pageWidth, pageHeight, 0.6));
    }

    // Simulate split words (V + - + 1001 → tests the WordGrouper)
    if (equipment.length > 0) {
      const splitTag = equipment[0].tag;
      const parts = splitTag.split('-');
      if (parts.length >= 2) {
        const baseX = 0.85 * pageWidth;
        const baseY = 0.15 * pageHeight;
        words.push(this._makeWord(parts[0], baseX, baseY, pageWidth, pageHeight));
        words.push(this._makeWord('-', baseX + 40, baseY, pageWidth, pageHeight));
        words.push(this._makeWord(parts.slice(1).join('-'), baseX + 50, baseY, pageWidth, pageHeight));
      }
    }

    return {
      words,
      fullText: words.map(w => w.text).join(' '),
      pageWidth,
      pageHeight,
    };
  }

  _makeWord(text, x, y, pageWidth, pageHeight, confidence = null) {
    const charWidth = 12;
    const height = 18;
    const width = text.length * charWidth;
    // Add slight randomness to confidence (0.85-0.99)
    const conf = confidence ?? (0.85 + Math.random() * 0.14);

    return {
      text,
      confidence: conf,
      vertices: [
        { x: Math.round(x), y: Math.round(y) },
        { x: Math.round(x + width), y: Math.round(y) },
        { x: Math.round(x + width), y: Math.round(y + height) },
        { x: Math.round(x), y: Math.round(y + height) },
      ],
      pageWidth,
      pageHeight,
    };
  }
}
