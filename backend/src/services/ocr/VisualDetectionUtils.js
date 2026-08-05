import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

export function isPdfBuffer(buffer, contentType = '') {
  if (!buffer) return false;
  return String(contentType || '').toLowerCase().includes('pdf') || buffer.slice(0, 5).toString() === '%PDF-';
}

export async function rasterizeForVisualDetection({ fileBuffer, contentType = '', density = 420, page = 0 } = {}) {
  if (!isPdfBuffer(fileBuffer, contentType)) {
    const meta = await sharp(fileBuffer).metadata().catch(() => ({}));
    return {
      rasterBuffer: fileBuffer,
      contentType: 'image/png',
      sourceType: 'raster',
      width: Number(meta.width || 0),
      height: Number(meta.height || 0),
    };
  }

  try {
    const raster = await sharp(fileBuffer, { density, page })
      .png()
      .toBuffer();
    const meta = await sharp(raster).metadata();
    return {
      rasterBuffer: raster,
      contentType: 'image/png',
      sourceType: `pdf_rasterized_page_${page + 1}`,
      width: Number(meta.width || 0),
      height: Number(meta.height || 0),
    };
  } catch (_) {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-symbol-pdf-'));
    try {
      const inPdf = path.join(tmpRoot, 'input.pdf');
      const outPrefix = path.join(tmpRoot, `page-${page + 1}`);
      const outPng = `${outPrefix}.png`;
      await fs.writeFile(inPdf, fileBuffer);
      try {
        await execFileAsync('pdftoppm', [
          '-f', String(page + 1),
          '-singlefile',
          '-png',
          '-r', String(density),
          inPdf,
          outPrefix,
        ]);
      } catch (err) {
        // On Windows dev machines this usually means Poppler is not installed /
        // not on PATH. Surface a clear remediation message instead of ENOENT.
        if (String(err?.code || '').toUpperCase() === 'ENOENT' ||
            /pdftoppm/i.test(String(err?.message || ''))) {
          throw new Error(
            'Missing PDF rasterizer `pdftoppm` (Poppler). Install Poppler and add `pdftoppm` to PATH, or run re-pass on non-PDF images.'
          );
        }
        throw err;
      }
      const raster = await fs.readFile(outPng);
      const meta = await sharp(raster).metadata();
      return {
        rasterBuffer: raster,
        contentType: 'image/png',
        sourceType: `pdf_rasterized_page_${page + 1}_poppler`,
        width: Number(meta.width || 0),
        height: Number(meta.height || 0),
      };
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function resizeForDetection(imageBuffer, { maxDimOverride } = {}) {
  const maxDim = maxDimOverride || Math.max(512, Number(process.env.AI_ANNOTATE_DDS_MAX_DIM || 1536));
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height) {
    return { buffer: imageBuffer, width: Number(meta.width || 0), height: Number(meta.height || 0), scale: 1 };
  }
  const longest = Math.max(meta.width, meta.height);
  if (longest <= maxDim) {
    return { buffer: imageBuffer, width: meta.width, height: meta.height, scale: 1 };
  }
  const scale = maxDim / longest;
  const newW = Math.round(meta.width * scale);
  const newH = Math.round(meta.height * scale);
  const resized = await sharp(imageBuffer)
    .resize(newW, newH, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return { buffer: resized, width: newW, height: newH, scale };
}

export function isDdsTaskEndpoint(url) {
  return /api\.deepdataspace\.com\/v2\/task\//i.test(String(url || ''));
}

function makeHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Token = token;
    headers.Authorization = `Bearer ${token}`;
    headers['x-api-key'] = token;
  }
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callDdsDetect({
  endpointUrl,
  token,
  imageBuffer,
  payloadBuilder,
  maxDimOverride,
} = {}) {
  const resized = await resizeForDetection(imageBuffer, maxDimOverride ? { maxDimOverride } : {});
  const imageDataUrl = `data:image/png;base64,${resized.buffer.toString('base64')}`;
  const headers = makeHeaders(token);
  const payload = payloadBuilder({
    imageDataUrl,
    resizeScale: resized.scale,
    detectionWidth: resized.width,
    detectionHeight: resized.height,
  });

  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const createJson = await res.json().catch(() => ({}));
  if (!res.ok || Number(createJson?.code ?? 0) !== 0 || !createJson?.data?.task_uuid) {
    throw new Error(`DDS task create failed (${res.status}): ${JSON.stringify(createJson)}`);
  }

  const taskUuid = createJson.data.task_uuid;
  const statusUrl = `https://api.deepdataspace.com/v2/task_status/${taskUuid}`;
  const timeoutMs = Math.max(8000, Number(process.env.AI_ANNOTATE_DDS_TIMEOUT_MS || 90000));
  const pollEveryMs = Math.max(400, Number(process.env.AI_ANNOTATE_DDS_POLL_MS || 1200));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const statusRes = await fetch(statusUrl, { method: 'GET', headers });
    const statusJson = await statusRes.json().catch(() => ({}));
    const status = String(statusJson?.data?.status || '').toLowerCase();
    if (status === 'success') {
      return {
        result: statusJson?.data?.result || {},
        meta: {
          resizeScale: resized.scale,
          detectionWidth: resized.width,
          detectionHeight: resized.height,
          payloadMeta: payload._meta || {},
        },
      };
    }
    if (status === 'failed') {
      throw new Error(`DDS task failed: ${statusJson?.data?.error || 'unknown error'}`);
    }
    await sleep(pollEveryMs);
  }

  throw new Error('DDS task timed out while waiting for detection result');
}

export function toPixelBoxFromPct(box, imageWidth, imageHeight, scale = 1) {
  const x = Math.max(0, Math.round((Number(box?.xPct ?? box?.x_pct ?? 0) / 100) * imageWidth * scale));
  const y = Math.max(0, Math.round((Number(box?.yPct ?? box?.y_pct ?? 0) / 100) * imageHeight * scale));
  const w = Math.max(4, Math.round((Number(box?.wPct ?? box?.w_pct ?? 0) / 100) * imageWidth * scale));
  const h = Math.max(4, Math.round((Number(box?.hPct ?? box?.h_pct ?? 0) / 100) * imageHeight * scale));
  return { x, y, w, h };
}

export function extractDdsDetections(result) {
  const arrays = [
    result?.objects,
    result?.detections,
    result?.results,
    result?.data?.objects,
    result?.data?.detections,
    result?.predictions,
  ].filter(Array.isArray);
  return arrays.flat();
}
