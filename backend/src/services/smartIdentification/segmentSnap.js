/**
 * Backend snap helpers — mirror of frontend smartIdentSnap.js
 */

const DEFAULT_SNAP_PCT = 1.2;

function distPct(a, b) {
  return Math.hypot(Number(a.xPct) - Number(b.xPct), Number(a.yPct) - Number(b.yPct));
}

export function buildSnapPointsFromOverlay(overlay, ocrExtractions = []) {
  const points = [];
  for (const e of overlay?.equipment || []) {
    if (e.xPct == null) continue;
    points.push({ xPct: Number(e.xPct), yPct: Number(e.yPct), type: 'equipment', label: e.tag });
  }
  for (const i of overlay?.instruments || []) {
    if (i.xPct == null) continue;
    points.push({ xPct: Number(i.xPct), yPct: Number(i.yPct), type: 'instrument', label: i.tag });
  }
  for (const l of overlay?.lines || []) {
    if (l.xPct == null) continue;
    points.push({ xPct: Number(l.xPct), yPct: Number(l.yPct), type: 'line', label: l.lineNumber });
  }
  for (const ext of ocrExtractions) {
    if (ext.bbox_x_pct == null) continue;
    points.push({
      xPct: Number(ext.bbox_x_pct) + Number(ext.bbox_w_pct || 0) / 2,
      yPct: Number(ext.bbox_y_pct) + Number(ext.bbox_h_pct || 0) / 2,
      type: 'ocr',
      label: ext.extracted_text,
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

/** Drop very short unassigned pipe runs to reduce clutter */
export function pruneNoiseSegments(segments, minLinePct = 0.25) {
  return segments.filter((seg) => {
    if (seg.segmentType !== 'line') return true;
    const pts = seg.geometry?.points || [];
    if (pts.length < 2) return false;
    const len = distPct(pts[0], pts[1]);
    return len >= minLinePct;
  });
}
