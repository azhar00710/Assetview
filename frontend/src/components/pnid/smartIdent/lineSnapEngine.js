/**
 * Magnetic snap for Smart Identification drawing.
 * Snaps to: P&ID guide lines (black pipe runs), ortho angles, segment endpoints, entities.
 */

const ORTHO_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const ORTHO_TOL_DEG = 8;
const DEFAULT_THRESHOLD_PCT = 1.0;

function dist(a, b) {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function projectOntoSegment(point, p1, p2) {
  const dx = p2.xPct - p1.xPct;
  const dy = p2.yPct - p1.yPct;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { ...p1, dist: dist(point, p1) };
  let t = ((point.xPct - p1.xPct) * dx + (point.yPct - p1.yPct) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { xPct: p1.xPct + t * dx, yPct: p1.yPct + t * dy };
  return { ...proj, dist: dist(point, proj) };
}

/** Nearest point on any guide line segment */
function snapToGuideLines(point, guideLines, thresholdPct) {
  let best = null;
  for (const g of guideLines) {
    const pts = g.points || [];
    if (pts.length < 2) continue;
    const proj = projectOntoSegment(point, pts[0], pts[1]);
    if (proj.dist <= thresholdPct && (!best || proj.dist < best.dist)) {
      best = { xPct: proj.xPct, yPct: proj.yPct, dist: proj.dist, source: 'pipe' };
    }
    for (const p of pts) {
      const d = dist(point, p);
      if (d <= thresholdPct && (!best || d < best.dist)) {
        best = { xPct: p.xPct, yPct: p.yPct, dist: d, source: 'pipe-end' };
      }
    }
  }
  return best;
}

/** Snap to endpoints of user-drawn segments */
function snapToSegmentEndpoints(point, segments, thresholdPct, excludeId) {
  let best = null;
  for (const seg of segments) {
    if (seg.id === excludeId) continue;
    for (const p of seg.geometry?.points || []) {
      const d = dist(point, p);
      if (d <= thresholdPct && (!best || d < best.dist)) {
        best = { xPct: p.xPct, yPct: p.yPct, dist: d, source: 'segment' };
      }
    }
  }
  return best;
}

/** Snap to entity overlay positions */
function snapToEntities(point, snapPoints, thresholdPct) {
  let best = null;
  for (const sp of snapPoints) {
    const d = dist(point, sp);
    if (d <= thresholdPct && (!best || d < best.dist)) {
      best = { xPct: sp.xPct, yPct: sp.yPct, dist: d, source: sp.type || 'entity' };
    }
  }
  return best;
}

/** Orthogonal snap when drawing a line from anchor */
function snapOrtho(anchor, cursor) {
  const dx = cursor.xPct - anchor.xPct;
  const dy = cursor.yPct - anchor.yPct;
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return cursor;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  let bestAngle = ORTHO_ANGLES[0];
  let bestDiff = 360;
  for (const a of ORTHO_ANGLES) {
    const diff = Math.min(Math.abs(angle - a), 360 - Math.abs(angle - a));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestAngle = a;
    }
  }
  if (bestDiff > ORTHO_TOL_DEG) return cursor;
  const rad = (bestAngle * Math.PI) / 180;
  return {
    xPct: anchor.xPct + Math.cos(rad) * len,
    yPct: anchor.yPct + Math.sin(rad) * len,
  };
}

/**
 * Resolve snapped cursor position for drawing.
 */
export function resolveSnapPoint({
  cursor,
  anchor = null,
  guideLines = [],
  segments = [],
  entityPoints = [],
  snapEnabled = true,
  orthoEnabled = true,
  thresholdPct = DEFAULT_THRESHOLD_PCT,
  excludeSegmentId = null,
}) {
  if (!snapEnabled) return { point: cursor, snap: null };

  let point = { ...cursor };

  if (anchor && orthoEnabled) {
    point = snapOrtho(anchor, point);
  }

  const candidates = [
    snapToGuideLines(point, guideLines, thresholdPct),
    snapToSegmentEndpoints(point, segments, thresholdPct, excludeSegmentId),
    snapToEntities(point, entityPoints, thresholdPct),
  ].filter(Boolean);

  if (!candidates.length) return { point, snap: null };

  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  return { point: { xPct: best.xPct, yPct: best.yPct }, snap: best };
}

/** Convert guide line API response to snap format */
export function normalizeGuideLines(lines = []) {
  return lines.map((l) => ({
    points: l.geometry?.points || l.points || [],
    orientation: l.metadata?.orientation,
  }));
}

export { DEFAULT_THRESHOLD_PCT };
