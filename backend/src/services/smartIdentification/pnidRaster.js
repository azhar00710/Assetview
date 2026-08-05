/**
 * Load and rasterize a P&ID file for smart identification processing.
 */

import prisma from '../../db.js';
import { getStorageProvider } from '../storage/index.js';
import { rasterizeForVisualDetection } from '../ocr/VisualDetectionUtils.js';

export async function getPnidRaster(pnidId, pageNumber = 1, { density } = {}) {
  const pnid = await prisma.pnid.findFirst({
    where: { id: pnidId, deleted_at: null },
    select: {
      storage_key: true,
      pnid_system: {
        where: { is_primary: true },
        include: { system: { select: { platform_id: true } } },
      },
    },
  });
  if (!pnid?.storage_key) {
    throw new Error('No P&ID file found for this drawing');
  }

  const platformId = pnid.pnid_system?.[0]?.system?.platform_id || null;
  const storage = await getStorageProvider(prisma, { platformId });
  const { buffer, contentType } = await storage.download(pnid.storage_key);

  const raster = await rasterizeForVisualDetection({
    fileBuffer: buffer,
    contentType: contentType || '',
    page: Math.max(0, pageNumber - 1),
    density: density ?? Number(process.env.SMART_IDENT_PDF_DENSITY || 420),
  });

  return {
    rasterBuffer: raster.rasterBuffer,
    width: raster.width,
    height: raster.height,
    sourceType: raster.sourceType,
  };
}
