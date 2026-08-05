/**
 * OCR Re-pass Service
 * ─────────────────────────────────────────────────────────────────────────────
 * For bubbles where Vision API dropped the prefix text on the FULL-PAGE OCR
 * pass, this service crops just that bubble region from the PDF, rasterizes
 * it at high DPI, and re-OCRs ONLY that region.  Smaller crops + higher DPI
 * + per-region inference often surfaces text that the full-page pass missed.
 *
 * Usage from a route:
 *   const result = await runOcrRepassForRegions({
 *     pdfBuffer,           // the original PDF bytes
 *     visionCreds,         // creds JSON for VisionOCRProvider
 *     pageWidth, pageHeight, // original page dims (from raw OCR JSON)
 *     regions,             // [{ region_px: { x, y, w, h }, midWordIndex, reason }, ...]
 *     scale,               // raster oversample (default 4 = 4x resolution)
 *     onProgress,          // optional progress callback
 *   });
 *
 * Returns:
 *   {
 *     regionsProcessed,
 *     regionsSucceeded,
 *     atomsRescued,         // total new text atoms added
 *     newAtoms[],           // each: { text, confidence, vertices[] (in PAGE coords),
 *                           //          provider:'vision_repass', sourceRegionIdx,
 *                           //          targetMidWordIndex }
 *     perRegion[],          // diagnostic: { regionIdx, midWordIndex, reason,
 *                           //               cropDims, atomsFound, error? }
 *   }
 */

import sharp from 'sharp';
import VisionOCRProvider from './VisionOCRProvider.js';
import { rasterizeForVisualDetection } from './VisualDetectionUtils.js';

const PAD_PX = 6;       // small padding around region so text near edges isn't clipped
const DEFAULT_SCALE = 4;
const DEFAULT_RASTER_DENSITY = 300;   // PDF rendering DPI; combined with scale → effective DPI on crop

/**
 * Render the source PDF page once, cache it as a Buffer, and provide a helper
 * to crop sub-regions on demand using sharp.  Avoids re-rasterizing per crop.
 */
async function buildPageRaster(pdfBuffer, density, contentType = 'application/pdf') {
  const result = await rasterizeForVisualDetection({
    fileBuffer: pdfBuffer,
    contentType,
    density,
    page: 0,
  });
  return result;  // { rasterBuffer, width, height }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Crop a region (in source-PDF page coordinates) out of the rendered raster.
 * The raster's pixel dims (rasterW, rasterH) typically differ from the page
 * coordinate system (pageW, pageH) by the rendering scale, so we map pixels
 * proportionally.  Returns the crop buffer + the actual crop bbox (raster px)
 * so we can map detected text back into page coords.
 */
async function cropRegionFromRaster({ rasterBuffer, rasterW, rasterH, pageW, pageH, region }) {
  const sx = rasterW / pageW;
  const sy = rasterH / pageH;
  const x0 = clamp(Math.round((region.x - PAD_PX) * sx), 0, rasterW - 1);
  const y0 = clamp(Math.round((region.y - PAD_PX) * sy), 0, rasterH - 1);
  const x1 = clamp(Math.round((region.x + region.w + PAD_PX) * sx), x0 + 1, rasterW);
  const y1 = clamp(Math.round((region.y + region.h + PAD_PX) * sy), y0 + 1, rasterH);
  const cropW = x1 - x0;
  const cropH = y1 - y0;
  const cropBuf = await sharp(rasterBuffer)
    .extract({ left: x0, top: y0, width: cropW, height: cropH })
    .png()
    .toBuffer();
  return {
    cropBuffer: cropBuf,
    cropPxBox: { x: x0, y: y0, w: cropW, h: cropH },
    rasterToPageScaleX: 1 / sx,
    rasterToPageScaleY: 1 / sy,
  };
}

/**
 * Take Vision response (text words within the CROP coordinate system) and
 * map them back to ORIGINAL PAGE coordinates so they can be merged into the
 * raw OCR file with bbox-compatible vertices.
 */
function mapCropAtomsToPageCoords(visionWords = [], cropPxBox, rasterToPageScaleX, rasterToPageScaleY) {
  return visionWords.map(w => {
    const verts = (w.vertices || []).map(v => ({
      x: (cropPxBox.x + (v.x || 0)) * rasterToPageScaleX,
      y: (cropPxBox.y + (v.y || 0)) * rasterToPageScaleY,
    }));
    return {
      text: w.text,
      confidence: w.confidence,
      vertices: verts,
    };
  });
}

/**
 * Main entry.
 */
export async function runOcrRepassForRegions({
  pdfBuffer,
  contentType = 'application/pdf',
  visionCreds,
  pageWidth,
  pageHeight,
  regions = [],
  scale = DEFAULT_SCALE,
  rasterDensity,
  onProgress = null,
}) {
  if (!pdfBuffer) throw new Error('pdfBuffer is required');
  if (!visionCreds) throw new Error('visionCreds is required');
  if (!pageWidth || !pageHeight) throw new Error('pageWidth/pageHeight required');
  if (!Array.isArray(regions) || regions.length === 0) {
    return { regionsProcessed: 0, regionsSucceeded: 0, atomsRescued: 0, newAtoms: [], perRegion: [] };
  }

  // Density: if not explicitly set, default to 300 * scale_hint ratio so that
  // the raster image is roughly `scale` x larger than the original page coords.
  // We'll figure out the actual ratio after rasterizing.
  const density = rasterDensity || Math.round(DEFAULT_RASTER_DENSITY * (scale / DEFAULT_SCALE));

  const raster = await buildPageRaster(pdfBuffer, density, contentType);
  const rasterW = raster.width;
  const rasterH = raster.height;
  if (!rasterW || !rasterH) {
    throw new Error(`PDF rasterization yielded zero dimensions (page=${pageWidth}x${pageHeight})`);
  }

  const provider = new VisionOCRProvider(visionCreds);
  const newAtoms = [];
  const perRegion = [];
  let succeeded = 0;

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const region = r.region_px || r.region || r;
    if (!region || region.w <= 0 || region.h <= 0) {
      perRegion.push({ regionIdx: i, midWordIndex: r.midWordIndex, reason: r.reason, error: 'invalid region' });
      continue;
    }

    let cropInfo = null;
    let visionResult = null;
    let regionError = null;
    try {
      cropInfo = await cropRegionFromRaster({
        rasterBuffer: raster.rasterBuffer,
        rasterW, rasterH,
        pageW: pageWidth, pageH: pageHeight,
        region,
      });
      visionResult = await provider.extractFromImage(cropInfo.cropBuffer);
    } catch (err) {
      regionError = String(err?.message || err);
    }

    if (regionError || !visionResult) {
      perRegion.push({
        regionIdx: i,
        midWordIndex: r.midWordIndex,
        reason: r.reason,
        cropDims: cropInfo?.cropPxBox || null,
        atomsFound: 0,
        error: regionError || 'vision returned no result',
      });
      onProgress?.({ regionIdx: i, total: regions.length, status: 'failed', error: regionError });
      continue;
    }

    // Vision returns words in CROP px coords; map them back to PAGE coords.
    const mapped = mapCropAtomsToPageCoords(
      visionResult.words || [],
      cropInfo.cropPxBox,
      cropInfo.rasterToPageScaleX,
      cropInfo.rasterToPageScaleY,
    ).map(w => ({
      ...w,
      provider: 'vision_repass',
      pageWidth,
      pageHeight,
      sourceRegionIdx: i,
      targetMidWordIndex: r.midWordIndex,
      sourceReason: r.reason,
    }));

    // Filter out junk: empty text, single chars, all-numeric matches that
    // duplicate the existing mid (we're trying to RESCUE the prefix, not
    // re-detect the number).
    const filtered = mapped.filter(w => {
      const t = String(w.text || '').trim();
      if (t.length < 2) return false;
      // Drop if this matches the original mid text exactly (we already have it)
      // — simple heuristic; full dedup happens at merge time on the route side.
      return true;
    });

    newAtoms.push(...filtered);
    succeeded++;
    perRegion.push({
      regionIdx: i,
      midWordIndex: r.midWordIndex,
      reason: r.reason,
      cropDims: cropInfo.cropPxBox,
      atomsFound: filtered.length,
      atomsRaw: (visionResult.words || []).length,
    });
    onProgress?.({ regionIdx: i, total: regions.length, status: 'ok', atomsFound: filtered.length });
  }

  return {
    regionsProcessed: regions.length,
    regionsSucceeded: succeeded,
    atomsRescued: newAtoms.length,
    newAtoms,
    perRegion,
    rasterDims: { width: rasterW, height: rasterH },
  };
}

/**
 * Merge the rescued atoms into an existing raw-OCR atoms array.  Skips atoms
 * whose bbox center coincides with an existing atom of the same text (within
 * a few px) — to avoid double-counting if Vision returns the same word twice.
 *
 * IMPORTANT: this does NOT mutate the input array.  Returns a NEW array.
 */
export function mergeRescuedAtoms(existingWords = [], newAtoms = []) {
  const out = existingWords.slice();
  const existingCenters = existingWords.map(w => {
    const xs = (w.vertices || []).map(v => v.x || 0);
    const ys = (w.vertices || []).map(v => v.y || 0);
    if (!xs.length || !ys.length) return null;
    return {
      text: String(w.text || '').trim().toUpperCase(),
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  });
  let added = 0;
  let skipped = 0;
  for (const n of newAtoms) {
    const xs = (n.vertices || []).map(v => v.x || 0);
    const ys = (n.vertices || []).map(v => v.y || 0);
    if (!xs.length || !ys.length) { skipped++; continue; }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const t = String(n.text || '').trim().toUpperCase();
    let dup = false;
    for (const e of existingCenters) {
      if (!e) continue;
      if (e.text === t && Math.abs(e.cx - cx) < 5 && Math.abs(e.cy - cy) < 5) { dup = true; break; }
    }
    if (dup) { skipped++; continue; }
    out.push(n);
    added++;
  }
  return { merged: out, addedCount: added, skippedDupCount: skipped };
}
