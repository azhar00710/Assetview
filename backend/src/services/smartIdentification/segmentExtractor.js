/**
 * Classical CV segment extraction from a P&ID boundary region.
 * Phase 1: threshold + line run scanning + connected-component shapes.
 */

import sharp from 'sharp';

const MIN_LINE_PX = 24;
const MIN_SHAPE_PX = 8;
const MAX_SHAPE_PX = 120;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toPct(px, total) {
  return Math.round((px / total) * 10000) / 100;
}

function pctPoint(xPx, yPx, crop, fullW, fullH) {
  const absX = crop.left + xPx;
  const absY = crop.top + yPx;
  return { xPct: toPct(absX, fullW), yPct: toPct(absY, fullH) };
}

/** Merge overlapping/near-duplicate line segments */
function mergeLines(lines, tolerance = 3) {
  const merged = [];
  for (const line of lines) {
    const dup = merged.find((m) => {
      if (m.orientation !== line.orientation) return false;
      if (m.orientation === 'h') {
        return Math.abs(m.y - line.y) <= tolerance &&
          !(line.x2 < m.x - tolerance || line.x > m.x2 + tolerance);
      }
      return Math.abs(m.x - line.x) <= tolerance &&
        !(line.y2 < m.y - tolerance || line.y > m.y2 + tolerance);
    });
    if (dup) {
      if (dup.orientation === 'h') {
        dup.x = Math.min(dup.x, line.x);
        dup.x2 = Math.max(dup.x2, line.x2);
      } else {
        dup.y = Math.min(dup.y, line.y);
        dup.y2 = Math.max(dup.y2, line.y2);
      }
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

/** Flood-fill connected component in binary image */
function findComponents(data, w, h) {
  const visited = new Uint8Array(w * h);
  const components = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || data[idx] === 0) continue;

      const pixels = [];
      const stack = [[x, y]];
      visited[idx] = 1;

      while (stack.length) {
        const [cx, cy] = stack.pop();
        pixels.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!visited[ni] && data[ni] > 0) {
            visited[ni] = 1;
            stack.push([nx, ny]);
          }
        }
      }

      if (pixels.length >= MIN_SHAPE_PX && pixels.length <= MAX_SHAPE_PX * MAX_SHAPE_PX) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const [px, py] of pixels) {
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const fillRatio = pixels.length / (bw * bh);
        components.push({ minX, minY, maxX, maxY, bw, bh, fillRatio, pixelCount: pixels.length });
      }
    }
  }
  return components;
}

function classifyComponent(comp) {
  const aspect = comp.bw / Math.max(1, comp.bh);
  const isSquareish = aspect >= 0.65 && aspect <= 1.55;
  const isHollow = comp.fillRatio < 0.55;

  if (isSquareish && isHollow && comp.bw >= 10 && comp.bh >= 10) {
    return 'circle';
  }
  if (comp.bw >= MIN_SHAPE_PX * 2 || comp.bh >= MIN_SHAPE_PX * 2) {
    return 'rect';
  }
  return 'symbol';
}

/**
 * Extract line and shape segments from a boundary on the full drawing raster.
 *
 * @param {Buffer} rasterBuffer - Full-page PNG buffer
 * @param {{ xPct: number, yPct: number, wPct: number, hPct: number }} boundary
 * @param {number} fullW - Full raster width in pixels
 * @param {number} fullH - Full raster height in pixels
 * @returns {Array<{ segmentType, geometry, confidence, metadata }>}
 */
export async function extractSegmentsFromBoundary(rasterBuffer, boundary, fullW, fullH) {
  const left = clamp(Math.floor((boundary.xPct / 100) * fullW), 0, fullW - 1);
  const top = clamp(Math.floor((boundary.yPct / 100) * fullH), 0, fullH - 1);
  const width = clamp(Math.floor((boundary.wPct / 100) * fullW), 1, fullW - left);
  const height = clamp(Math.floor((boundary.hPct / 100) * fullH), 1, fullH - top);
  const crop = { left, top, width, height };

  const { data, info } = await sharp(rasterBuffer)
    .extract(crop)
    .grayscale()
    .normalize()
    .threshold(155)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const rawLines = [];

  // Horizontal line runs
  for (let y = 0; y < h; y++) {
    let runStart = null;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && data[y * w + x] > 0;
      if (dark && runStart === null) runStart = x;
      if ((!dark || x === w) && runStart !== null) {
        const len = x - runStart;
        if (len >= MIN_LINE_PX) {
          rawLines.push({ orientation: 'h', x: runStart, y, x2: x - 1, y2: y, length: len });
        }
        runStart = null;
      }
    }
  }

  // Vertical line runs
  for (let x = 0; x < w; x++) {
    let runStart = null;
    for (let y = 0; y <= h; y++) {
      const dark = y < h && data[y * w + x] > 0;
      if (dark && runStart === null) runStart = y;
      if ((!dark || y === h) && runStart !== null) {
        const len = y - runStart;
        if (len >= MIN_LINE_PX) {
          rawLines.push({ orientation: 'v', x, y: runStart, x2: x, y2: y - 1, length: len });
        }
        runStart = null;
      }
    }
  }

  const lines = mergeLines(rawLines);
  const components = findComponents(data, w, h);
  const segments = [];
  let segIdx = 0;

  for (const line of lines) {
    const p1 = pctPoint(line.x, line.y, crop, fullW, fullH);
    const p2 = pctPoint(line.x2, line.y2, crop, fullW, fullH);
    const confidence = clamp(0.45 + (line.length / Math.max(w, h)) * 0.4, 0.45, 0.92);
    segments.push({
      segmentType: 'line',
      geometry: {
        points: [p1, p2],
        xPct: Math.min(p1.xPct, p2.xPct),
        yPct: Math.min(p1.yPct, p2.yPct),
        wPct: Math.abs(p2.xPct - p1.xPct) || 0.1,
        hPct: Math.abs(p2.yPct - p1.yPct) || 0.1,
      },
      confidence,
      metadata: { orientation: line.orientation, lengthPx: line.length, index: segIdx++ },
    });
  }

  for (const comp of components) {
    const cx = (comp.minX + comp.maxX) / 2;
    const cy = (comp.minY + comp.maxY) / 2;
    const segmentType = classifyComponent(comp);
    const p1 = pctPoint(comp.minX, comp.minY, crop, fullW, fullH);
    const p2 = pctPoint(comp.maxX, comp.maxY, crop, fullW, fullH);
    const confidence = segmentType === 'circle' ? 0.75 : 0.6;

    segments.push({
      segmentType,
      geometry: {
        points: segmentType === 'circle'
          ? [{ xPct: toPct(crop.left + cx, fullW), yPct: toPct(crop.top + cy, fullH) }]
          : [p1, p2],
        xPct: p1.xPct,
        yPct: p1.yPct,
        wPct: Math.max(0.15, p2.xPct - p1.xPct),
        hPct: Math.max(0.15, p2.yPct - p1.yPct),
        radiusPct: segmentType === 'circle'
          ? toPct(Math.max(comp.bw, comp.bh) / 2, fullW)
          : undefined,
      },
      confidence,
      metadata: { fillRatio: comp.fillRatio, pixelCount: comp.pixelCount, index: segIdx++ },
    });
  }

  return segments;
}

export const SEGMENT_COLORS = {
  unassigned: '#94A3B8',
  line: '#2D33E0',
  equipment: '#3BE494',
  instrument: '#F39C12',
  valve: '#E74C3C',
};

export function colorForAssignment(entityType) {
  return SEGMENT_COLORS[entityType] || SEGMENT_COLORS.unassigned;
}
