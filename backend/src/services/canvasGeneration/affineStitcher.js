/**
 * affineStitcher.js
 *
 * Upgrades coordinate stitching by computing affine transforms between
 * adjacent P&ID sheets using continuation line endpoints as anchor points.
 * Falls back to simple band placement when insufficient anchors exist.
 */

import { pctToCanvas, buildSheetIndexMap, sortSheets, SHEET_WIDTH, SHEET_HEIGHT, SHEET_GAP } from './coordinateStitcher.js';

/**
 * Compute 2D affine transform from source points to destination points.
 * For 2+ point pairs, uses least-squares fit.
 * Returns { a, b, tx, c, d, ty } such that:
 *   x' = a*x + b*y + tx
 *   y' = c*x + d*y + ty
 *
 * @param {Array<{x,y}>} srcPoints
 * @param {Array<{x,y}>} dstPoints
 * @returns {{ a, b, tx, c, d, ty } | null}
 */
export function computeAffineTransform(srcPoints, dstPoints) {
  const n = Math.min(srcPoints.length, dstPoints.length);
  if (n < 2) return null;

  if (n === 2) {
    // Exact solution for 2 points (rotation + uniform scale + translation)
    const [s0, s1] = srcPoints;
    const [d0, d1] = dstPoints;

    const dxs = s1.x - s0.x;
    const dys = s1.y - s0.y;
    const dxd = d1.x - d0.x;
    const dyd = d1.y - d0.y;

    const lenSq = dxs * dxs + dys * dys;
    if (lenSq < 1e-10) return null; // degenerate

    const a = (dxs * dxd + dys * dyd) / lenSq;
    const b = (dxs * dyd - dys * dxd) / lenSq;
    const tx = d0.x - a * s0.x - b * s0.y;
    const ty = d0.y + b * s0.x - a * s0.y;

    return { a, b: -b, tx, c: b, d: a, ty };
  }

  // Least-squares for 3+ points
  // Solve for [a, b, tx] and [c, d, ty] separately using normal equations
  // X = [x_i, y_i, 1], solve X^T X β = X^T y
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
  let sumXdx = 0, sumYdx = 0, sumDx = 0;
  let sumXdy = 0, sumYdy = 0, sumDy = 0;

  for (let i = 0; i < n; i++) {
    const sx = srcPoints[i].x;
    const sy = srcPoints[i].y;
    const dx = dstPoints[i].x;
    const dy = dstPoints[i].y;

    sumX += sx; sumY += sy;
    sumXX += sx * sx; sumYY += sy * sy; sumXY += sx * sy;
    sumXdx += sx * dx; sumYdx += sy * dx; sumDx += dx;
    sumXdy += sx * dy; sumYdy += sy * dy; sumDy += dy;
  }

  // Normal equation matrix: [[sumXX, sumXY, sumX], [sumXY, sumYY, sumY], [sumX, sumY, n]]
  const det = sumXX * (sumYY * n - sumY * sumY)
            - sumXY * (sumXY * n - sumY * sumX)
            + sumX * (sumXY * sumY - sumYY * sumX);

  if (Math.abs(det) < 1e-10) return null;

  const invDet = 1 / det;

  // Solve for a, b, tx (x-component)
  const a = invDet * (sumXdx * (sumYY * n - sumY * sumY) - sumYdx * (sumXY * n - sumY * sumX) + sumDx * (sumXY * sumY - sumYY * sumX));
  const b = invDet * (sumXX * (sumYdx * n - sumDx * sumY) - sumXY * (sumXdx * n - sumDx * sumX) + sumX * (sumXdx * sumY - sumYdx * sumX));
  const tx = invDet * (sumXX * (sumYY * sumDx - sumY * sumYdx) - sumXY * (sumXY * sumDx - sumY * sumXdx) + sumX * (sumXY * sumYdx - sumYY * sumXdx));

  // Solve for c, d, ty (y-component)
  const c = invDet * (sumXdy * (sumYY * n - sumY * sumY) - sumYdy * (sumXY * n - sumY * sumX) + sumDy * (sumXY * sumY - sumYY * sumX));
  const d = invDet * (sumXX * (sumYdy * n - sumDy * sumY) - sumXY * (sumXdy * n - sumDy * sumX) + sumX * (sumXdy * sumY - sumYdy * sumX));
  const ty = invDet * (sumXX * (sumYY * sumDy - sumY * sumYdy) - sumXY * (sumXY * sumDy - sumY * sumXdy) + sumX * (sumXY * sumYdy - sumYY * sumXdy));

  return { a, b, tx, c, d, ty };
}

/**
 * Apply affine transform to a point.
 */
export function applyAffineTransform(point, matrix) {
  return {
    x: Math.round(matrix.a * point.x + matrix.b * point.y + matrix.tx),
    y: Math.round(matrix.c * point.x + matrix.d * point.y + matrix.ty),
  };
}

/**
 * Build continuation anchor pairs between adjacent sheets.
 *
 * @param {Array} sheets - sorted P&ID records
 * @param {Array} continuationLines - pnid_line records where is_continuation = true
 * @param {Map} annotationPositions - Map of `${pnidId}:${lineId}` → { entryXPct, entryYPct, exitXPct, exitYPct }
 * @returns {Map<string, Array<{src: {x,y}, dst: {x,y}}>>} sheetPairKey → anchor pairs
 */
function buildAnchorPairs(sheets, continuationLines, annotationPositions) {
  const anchors = new Map(); // `${fromSheetIdx}-${toSheetIdx}` → [{src, dst}]

  const sheetIdxMap = new Map();
  sheets.forEach((s, i) => sheetIdxMap.set(s.id, i));

  for (const cl of continuationLines) {
    if (!cl.continuation_from_pnid_id) continue;

    const fromIdx = sheetIdxMap.get(cl.continuation_from_pnid_id);
    const toIdx = sheetIdxMap.get(cl.pnid_id);
    if (fromIdx === undefined || toIdx === undefined) continue;

    // Get annotation positions for both ends
    const exitKey = `${cl.continuation_from_pnid_id}:${cl.line_id}`;
    const entryKey = `${cl.pnid_id}:${cl.line_id}`;
    const exitPos = annotationPositions.get(exitKey);
    const entryPos = annotationPositions.get(entryKey);

    if (!exitPos || !entryPos) continue;

    const key = `${fromIdx}-${toIdx}`;
    if (!anchors.has(key)) anchors.set(key, []);

    // Source: exit point on fromSheet (in canvas coords of fromSheet)
    const src = pctToCanvas(exitPos.xPct, exitPos.yPct, fromIdx);
    // Destination: entry point on toSheet (in canvas coords of toSheet)
    const dst = pctToCanvas(entryPos.xPct, entryPos.yPct, toIdx);

    anchors.get(key).push({ src, dst });
  }

  return anchors;
}

/**
 * Stitch entity positions using affine transforms where continuation anchors exist,
 * falling back to simple band placement otherwise.
 *
 * @param {Array} sheets - P&ID records
 * @param {Array} entityPlacements - { entityId, entityType, pnidId, xPct, yPct, wPct, hPct }
 * @param {Array} continuationLines - pnid_line records with is_continuation = true
 * @param {Map} annotationPositions - continuation endpoint positions
 * @returns {{ positions: Array, warnings: string[] }}
 */
export function stitchWithAffine(sheets, entityPlacements, continuationLines, annotationPositions) {
  const sorted = sortSheets(sheets);
  const indexMap = buildSheetIndexMap(sorted);
  const warnings = [];

  // Build anchor pairs between adjacent sheets
  const anchorPairs = buildAnchorPairs(sorted, continuationLines, annotationPositions);

  // Compute transforms for sheet pairs with sufficient anchors
  const transforms = new Map(); // sheetIndex → affine matrix (transforms from band coords to aligned coords)

  // Sheet 0 is the reference — identity transform
  for (let i = 1; i < sorted.length; i++) {
    const key = `${i - 1}-${i}`;
    const pairs = anchorPairs.get(key) || [];

    if (pairs.length >= 2) {
      const srcPts = pairs.map(p => p.src);
      const dstPts = pairs.map(p => p.dst);
      const transform = computeAffineTransform(srcPts, dstPts);
      if (transform) {
        transforms.set(i, transform);
      } else {
        warnings.push(`Sheet ${sorted[i].drawing_number}: degenerate anchor points, using band placement`);
      }
    } else {
      warnings.push(`Sheet ${sorted[i].drawing_number}: ${pairs.length < 2 ? 'insufficient' : 'no'} continuation anchors (need ≥2), using approximate alignment`);
    }
  }

  // Position entities
  const positions = [];
  for (const placement of entityPlacements) {
    const sheetIndex = indexMap.get(placement.pnidId);
    if (sheetIndex === undefined) continue;

    const xPct = parseFloat(placement.xPct) || 0;
    const yPct = parseFloat(placement.yPct) || 0;
    if (xPct === 0 && yPct === 0) continue;

    let { x, y } = pctToCanvas(xPct, yPct, sheetIndex);

    // Apply affine transform if available for this sheet
    const transform = transforms.get(sheetIndex);
    if (transform) {
      const aligned = applyAffineTransform({ x, y }, transform);
      x = aligned.x;
      y = aligned.y;
    }

    positions.push({
      entityId: placement.entityId,
      entityType: placement.entityType,
      x,
      y,
      width: placement.wPct ? Math.round((parseFloat(placement.wPct) / 100) * SHEET_WIDTH) : null,
      height: placement.hPct ? Math.round((parseFloat(placement.hPct) / 100) * SHEET_HEIGHT) : null,
      sheetIndex,
      pnidId: placement.pnidId,
    });
  }

  return { positions, warnings };
}

export { sortSheets };
