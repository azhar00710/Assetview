/**
 * Snap digitized segment geometry to known features (entities, OCR tags, junctions).
 */

const DEFAULT_SNAP_PCT = 1.2;

function distPct(a, b) {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function lineLengthPct(points) {
  if (!points || points.length < 2) return 0;
  return distPct(points[0], points[1]);
}

/** Collect snap targets from overlay + OCR extractions */
export function buildSnapPoints({ equipment = [], instruments = [], lines = [], ocrExtractions = [] } = {}) {
  const points = [];

  for (const e of equipment) {
    if (e.xPct == null) continue;
    points.push({
      xPct: Number(e.xPct),
      yPct: Number(e.yPct),
      type: 'equipment',
      id: e.id,
      label: e.tag,
    });
  }
  for (const i of instruments) {
    if (i.xPct == null) continue;
    points.push({
      xPct: Number(i.xPct),
      yPct: Number(i.yPct),
      type: 'instrument',
      id: i.id,
      label: i.tag,
    });
  }
  for (const l of lines) {
    if (l.xPct == null) continue;
    points.push({
      xPct: Number(l.xPct),
      yPct: Number(l.yPct),
      type: 'line',
      id: l.id,
      label: l.lineNumber,
    });
  }
  for (const ext of ocrExtractions) {
    const x = ext.bbox_x_pct ?? ext.bboxXPct;
    const y = ext.bbox_y_pct ?? ext.bboxYPct;
    const w = ext.bbox_w_pct ?? ext.bboxWPct ?? 0;
    const h = ext.bbox_h_pct ?? ext.bboxHPct ?? 0;
    if (x == null || y == null) continue;
    points.push({
      xPct: Number(x) + Number(w) / 2,
      yPct: Number(y) + Number(h) / 2,
      type: 'ocr',
      id: ext.id,
      label: ext.extracted_text || ext.extractedText,
    });
  }

  return points;
}

function nearestSnap(point, snapPoints, thresholdPct) {
  let best = null;
  let bestDist = thresholdPct;
  for (const sp of snapPoints) {
    const d = distPct(point, sp);
    if (d < bestDist) {
      bestDist = d;
      best = sp;
    }
  }
  return best;
}

/**
 * Snap segment endpoints / centers to nearby features.
 * Returns new segment array (does not mutate input).
 */
export function snapSegments(segments, snapPoints, thresholdPct = DEFAULT_SNAP_PCT) {
  if (!snapPoints?.length) return segments;

  return segments.map((seg) => {
    const geometry = { ...(seg.geometry || {}) };
    const points = (geometry.points || []).map((p) => ({ ...p }));
    let snappedTo = null;

    if (seg.segmentType === 'line' && points.length >= 2) {
      for (let i = 0; i < points.length; i++) {
        const match = nearestSnap(points[i], snapPoints, thresholdPct);
        if (match) {
          points[i] = { xPct: match.xPct, yPct: match.yPct };
          snappedTo = snappedTo || match;
        }
      }
    } else if (points.length >= 1) {
      const match = nearestSnap(points[0], snapPoints, thresholdPct);
      if (match) {
        points[0] = { xPct: match.xPct, yPct: match.yPct };
        snappedTo = match;
      }
    }

    if (!snappedTo) return seg;

    return {
      ...seg,
      geometry: { ...geometry, points },
      metadata: {
        ...(seg.metadata || {}),
        snapped: true,
        snapTarget: snappedTo.label || snappedTo.type,
      },
    };
  });
}

/** Hide noisy micro-lines unless assigned (reduces visual clutter) */
export function filterDisplaySegments(segments, { showPipeLines = false, minLinePct = 0.35 } = {}) {
  return segments.filter((seg) => {
    if (seg.segmentType !== 'line') return true;
    if (seg.linkedEntityId) return true;
    if (showPipeLines) return lineLengthPct(seg.geometry?.points) >= minLinePct * 0.5;
    return false;
  });
}

export { lineLengthPct, DEFAULT_SNAP_PCT };
