/**
 * Continuation reference detector for off-sheet connector callouts.
 * Extracts drawing cross-reference, connector ID, line number, and direction.
 */

const DRAWING_REGEX = /\b[A-Z]{2,4}-\d{2}-[A-Z]-\d{5,}-SHT-\d{3}\b/i;
const CONNECTOR_ID_REGEX = /^\d{3,5}$/;
const LINE_LIKE_REGEX = /\b\d+(?:-\d\/\d)?["']?-[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]\b/i;

function getItemText(item) {
  return String(item?.text || '').trim();
}

function getCenter(item) {
  const bb = item?.boundingBox;
  if (bb && Number.isFinite(bb.minX) && Number.isFinite(bb.maxX) && Number.isFinite(bb.minY) && Number.isFinite(bb.maxY)) {
    return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  }
  const p = item?.position_pct;
  if (p && Number.isFinite(p.x_pct) && Number.isFinite(p.y_pct)) {
    return { x: p.x_pct * 10, y: p.y_pct * 10 }; // coarse fallback when only pct is available
  }
  return null;
}

function distance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function inferDirection(text = '') {
  const t = String(text).toUpperCase();
  if (/\bFROM\b/.test(t)) return 'from';
  if (/\bTO\b/.test(t)) return 'to';
  return null;
}

/**
 * @param {Array<{text: string, boundingBox?: object, position_pct?: object, wordIndices?: number[]}>} items
 * @returns {Array<{targetDrawing: string, connectorId: string|null, lineNumber: string|null, direction: 'from'|'to'|null, confidence: number, sourceText: string, wordIndices?: number[]}>}
 */
export function detectContinuationReferences(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const enriched = items.map(item => ({
    ...item,
    _text: getItemText(item),
    _center: getCenter(item),
  })).filter(i => i._text.length > 0);

  const drawingItems = enriched.filter(i => DRAWING_REGEX.test(i._text));
  if (drawingItems.length === 0) return [];

  const connectorItems = enriched.filter(i => CONNECTOR_ID_REGEX.test(i._text));
  const lineItems = enriched.filter(i => LINE_LIKE_REGEX.test(i._text));

  const references = [];
  const seen = new Set();
  const maxRadiusPx = 260;

  for (const d of drawingItems) {
    const drawingMatch = d._text.match(DRAWING_REGEX);
    if (!drawingMatch) continue;
    const drawing = drawingMatch[0].toUpperCase();
    const dCenter = d._center;

    let connectorId = null;
    let lineNumber = null;
    let direction = inferDirection(d._text);
    let confidence = 0.75;

    if (dCenter) {
      const nearestConnector = connectorItems
        .map(c => ({ c, dist: distance(dCenter, c._center) }))
        .filter(x => x.dist <= maxRadiusPx)
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearestConnector) {
        connectorId = nearestConnector.c._text;
        confidence += 0.1;
      }

      const nearestLine = lineItems
        .map(l => ({ l, dist: distance(dCenter, l._center) }))
        .filter(x => x.dist <= maxRadiusPx * 1.25)
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearestLine) {
        lineNumber = nearestLine.l._text.toUpperCase();
        confidence += 0.1;
        if (!direction) direction = inferDirection(nearestLine.l._text);
      }
    }

    const key = `${drawing}|${connectorId || ''}|${lineNumber || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    references.push({
      targetDrawing: drawing,
      connectorId,
      lineNumber,
      direction: direction || null,
      confidence: Math.min(0.99, Number(confidence.toFixed(2))),
      sourceText: d._text,
      wordIndices: d.wordIndices || [],
      type: 'continuation_reference',
    });
  }

  return references;
}

