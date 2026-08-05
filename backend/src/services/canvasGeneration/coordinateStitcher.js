/**
 * coordinateStitcher.js
 *
 * Normalizes percentage-based annotation coordinates from multiple P&ID sheets
 * into a unified canvas coordinate space for React Flow rendering.
 *
 * Each sheet occupies a horizontal band. Continuation lines serve as
 * cross-sheet stitching anchors.
 */

const SHEET_WIDTH = 1200;   // canvas pixels per sheet
const SHEET_HEIGHT = 800;
const SHEET_GAP = 200;      // gap between sheets

/**
 * Sort P&ID sheets into a rendering order.
 * Uses drawing_number for natural ordering.
 */
function sortSheets(sheets) {
  return [...sheets].sort((a, b) => {
    const da = a.drawing_number || '';
    const db = b.drawing_number || '';
    return da.localeCompare(db, undefined, { numeric: true });
  });
}

/**
 * Convert a percentage position on a given sheet to canvas coordinates.
 *
 * @param {number} xPct  - x position as 0-100 percentage on the sheet
 * @param {number} yPct  - y position as 0-100 percentage on the sheet
 * @param {number} sheetIndex - zero-based index in the sorted sheet list
 * @returns {{ x: number, y: number }}
 */
function pctToCanvas(xPct, yPct, sheetIndex) {
  return {
    x: Math.round(sheetIndex * (SHEET_WIDTH + SHEET_GAP) + (xPct / 100) * SHEET_WIDTH),
    y: Math.round((yPct / 100) * SHEET_HEIGHT),
  };
}

/**
 * Build a mapping from pnidId → sheetIndex for coordinate conversion.
 *
 * @param {Array} sheets - Array of { id, drawing_number, ... } P&ID records
 * @returns {Map<string, number>} pnidId → sheetIndex
 */
function buildSheetIndexMap(sheets) {
  const sorted = sortSheets(sheets);
  const map = new Map();
  sorted.forEach((sheet, idx) => {
    map.set(sheet.id, idx);
  });
  return map;
}

/**
 * Stitch entity positions from multiple sheets into canvas coordinates.
 *
 * @param {Array} sheets - P&ID records with drawing_number
 * @param {Array} entityPlacements - Array of { entityId, entityType, pnidId, xPct, yPct, wPct, hPct }
 * @returns {Array} Array of { entityId, entityType, x, y, width, height, sheetIndex, pnidId }
 */
export function stitchCoordinates(sheets, entityPlacements) {
  const indexMap = buildSheetIndexMap(sheets);
  const positions = [];

  for (const placement of entityPlacements) {
    const sheetIndex = indexMap.get(placement.pnidId);
    if (sheetIndex === undefined) continue;

    const xPct = parseFloat(placement.xPct) || 0;
    const yPct = parseFloat(placement.yPct) || 0;

    if (xPct === 0 && yPct === 0) continue; // skip unpositioned entities

    const { x, y } = pctToCanvas(xPct, yPct, sheetIndex);

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

  return positions;
}

/**
 * Get the bounding box center of a positioned entity for edge snapping.
 */
export function entityCenter(pos) {
  const w = pos.width || 120;
  const h = pos.height || 100;
  return {
    x: pos.x + w / 2,
    y: pos.y + h / 2,
  };
}

export { SHEET_WIDTH, SHEET_HEIGHT, SHEET_GAP, pctToCanvas, buildSheetIndexMap, sortSheets };
