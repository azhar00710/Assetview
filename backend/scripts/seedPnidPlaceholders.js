/**
 * Create minimal placeholder PDF files for P&IDs that have storage_key but no file on disk.
 * Usage: node scripts/seedPnidPlaceholders.js
 */

import prisma from '../src/db.js';
import { getStorageProvider, clearProviderCache } from '../src/services/storage/index.js';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';

function escapePdfText(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMinimalPdf(title) {
  const safe = escapePdfText(title);
  const lines = [
    'AssetView — Placeholder P&ID',
    safe,
    'Upload the real drawing via Admin > P&IDs > Upload',
  ];
  let y = 750;
  const streamParts = ['BT /F1 14 Tf'];
  for (const line of lines) {
    streamParts.push(`72 ${y} Td (${escapePdfText(line)}) Tj`);
    y -= 28;
  }
  streamParts.push('ET');
  const stream = streamParts.join('\n');
  const streamLen = Buffer.byteLength(stream, 'utf8');

  const parts = [];
  const offsets = [0];
  const add = (s) => { offsets.push(Buffer.byteLength(parts.join(''), 'utf8')); parts.push(s); };

  add('%PDF-1.4\n');
  add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  add('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  add('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n');
  add(`4 0 obj << /Length ${streamLen} >> stream\n${stream}\nendstream endobj\n`);
  add('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');

  const body = parts.join('');
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  let pos = 0;
  for (let i = 1; i < offsets.length; i++) {
    pos = offsets[i];
    xref += `${String(pos).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref, 'utf8');
}

async function ensureStorageBasePath(platformId) {
  clearProviderCache();
  const storage = await getStorageProvider(prisma, { platformId });
  await mkdir(storage.basePath, { recursive: true });
  return storage;
}

async function main() {
  // Fix double-pids path: base_path should be .../storage, not .../storage/pids
  await prisma.$executeRaw`
    UPDATE storage_config
    SET base_path = ${process.env.STORAGE_LOCAL_BASE_PATH || 'D:/Development work/New folder/app-assetview/backend/storage'},
        updated_at = NOW()
    WHERE scope_type = 'platform'
      AND provider = 'local'
      AND base_path LIKE ${'%/storage/pids'}
  `.catch(() => {});

  clearProviderCache();

  const pnids = await prisma.pnid.findMany({
    where: { deleted_at: null, storage_key: { not: null } },
    select: {
      id: true,
      drawing_number: true,
      storage_key: true,
      pnid_system: {
        take: 1,
        include: { system: { select: { platform_id: true } } },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const pnid of pnids) {
    const platformId = pnid.pnid_system[0]?.system?.platform_id;
    if (!platformId) {
      console.warn(`Skip ${pnid.drawing_number}: no platform link`);
      skipped++;
      continue;
    }

    const storage = await ensureStorageBasePath(platformId);
    const fullPath = join(storage.basePath, pnid.storage_key);

    if (existsSync(fullPath)) {
      skipped++;
      continue;
    }

    await mkdir(dirname(fullPath), { recursive: true });
    const pdf = buildMinimalPdf(pnid.drawing_number);
    await writeFile(fullPath, pdf);
    console.log(`Created placeholder: ${pnid.storage_key}`);
    created++;
  }

  console.log(`Done. Created ${created}, skipped ${skipped} (already exist or no platform).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
