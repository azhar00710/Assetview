import sharp from 'sharp';
import prisma from '../../db.js';
import { getStorageProvider } from '../storage/index.js';

const VALID_CATEGORIES = new Set(['instrument', 'valve', 'pump', 'equipment', 'piping', 'general']);

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'symbol';
}

export function makeSymbolKey(label, existingKeys = new Set()) {
  let base = `sym_custom_${slugify(label)}`;
  let key = base;
  let n = 2;
  while (existingKeys.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

export function serializeSymbol(row) {
  if (!row) return null;
  const imageUrl = row.storage_key
    ? `/api/v1/symbols/${row.id}/image`
    : null;
  return {
    id: row.symbol_key,
    dbId: row.id,
    symbolKey: row.symbol_key,
    label: row.label,
    abbr: row.abbr || row.label?.slice(0, 6)?.toUpperCase() || 'SYM',
    categoryId: row.category,
    category: row.category,
    keywords: row.keywords || [],
    renderType: row.render_type || 'raster',
    imageUrl,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    isActive: row.is_active,
    source: 'custom',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPidSymbols({ activeOnly = true } = {}) {
  const rows = await prisma.pid_symbol.findMany({
    where: activeOnly ? { is_active: true } : undefined,
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
  });
  return rows.map(serializeSymbol);
}

export async function getPidSymbolById(id) {
  const row = await prisma.pid_symbol.findFirst({
    where: {
      OR: [{ id }, { symbol_key: id }],
    },
  });
  return serializeSymbol(row);
}

export async function createPidSymbol({ label, abbr, category, keywords = [] }) {
  if (!label?.trim()) throw new Error('label is required');
  const cat = VALID_CATEGORIES.has(category) ? category : 'general';

  const existing = await prisma.pid_symbol.findMany({ select: { symbol_key: true } });
  const keys = new Set(existing.map((r) => r.symbol_key));
  const symbolKey = makeSymbolKey(label, keys);

  const row = await prisma.pid_symbol.create({
    data: {
      symbol_key: symbolKey,
      label: label.trim(),
      abbr: abbr?.trim() || null,
      category: cat,
      keywords: Array.isArray(keywords) ? keywords : [],
      render_type: 'raster',
    },
  });
  return serializeSymbol(row);
}

export async function updatePidSymbol(id, data) {
  const existing = await prisma.pid_symbol.findFirst({
    where: { OR: [{ id }, { symbol_key: id }] },
  });
  if (!existing) throw new Error('Symbol not found');

  const patch = {};
  if (data.label != null) patch.label = String(data.label).trim();
  if (data.abbr != null) patch.abbr = data.abbr ? String(data.abbr).trim() : null;
  if (data.category != null && VALID_CATEGORIES.has(data.category)) patch.category = data.category;
  if (data.keywords != null) patch.keywords = Array.isArray(data.keywords) ? data.keywords : [];
  if (data.is_active != null) patch.is_active = !!data.is_active;

  const row = await prisma.pid_symbol.update({
    where: { id: existing.id },
    data: patch,
  });
  return serializeSymbol(row);
}

export async function deletePidSymbol(id) {
  const existing = await prisma.pid_symbol.findFirst({
    where: { OR: [{ id }, { symbol_key: id }] },
  });
  if (!existing) throw new Error('Symbol not found');

  if (existing.storage_key) {
    try {
      const storage = await getStorageProvider(prisma);
      await storage.delete(existing.storage_key);
    } catch {
      // ignore missing file
    }
  }

  await prisma.pid_symbol.delete({ where: { id: existing.id } });
  return { success: true };
}

/**
 * Convert uploaded image/TIF to PNG and store under symbols/{symbolKey}.png
 */
export async function uploadPidSymbolImage(id, { file, filename, contentType }) {
  if (!file) throw new Error('file is required (base64 encoded)');

  const existing = await prisma.pid_symbol.findFirst({
    where: { OR: [{ id }, { symbol_key: id }] },
  });
  if (!existing) throw new Error('Symbol not found');

  const inputBuffer = Buffer.from(file, 'base64');
  const pngBuffer = await sharp(inputBuffer)
    .png()
    .toBuffer();

  const storageKey = `symbols/${existing.symbol_key}.png`;
  const storage = await getStorageProvider(prisma);
  await storage.upload(pngBuffer, storageKey, { contentType: 'image/png' });

  const row = await prisma.pid_symbol.update({
    where: { id: existing.id },
    data: {
      storage_key: storageKey,
      mime_type: 'image/png',
    },
  });

  return serializeSymbol(row);
}

export async function getPidSymbolImageBuffer(id) {
  const existing = await prisma.pid_symbol.findFirst({
    where: { OR: [{ id }, { symbol_key: id }] },
  });
  if (!existing?.storage_key) return null;

  const storage = await getStorageProvider(prisma);
  const { buffer, contentType } = await storage.download(existing.storage_key);
  return { buffer, contentType: contentType || existing.mime_type || 'image/png' };
}
