/**
 * P&ID symbol catalog — ISO 15519-2:2015 / ISO 10628-2 vector symbols
 * plus admin-managed custom raster symbols.
 */
import spriteManifest from './pidSymbolSprites.json';
import { ISO_SYMBOL_EXTENSIONS } from './isoSymbolExtensions';
import { getIsoGraphics } from './iso15519Graphics';

export const ISO_STANDARD_REF = 'ISO 15519-2:2015';
export const ISO_GRAPHICS_REF = 'ISO 10628-2';

/** Merge base catalog with ISO extensions (extensions win on id collision). */
const BASE_SYMBOLS = spriteManifest.symbols || [];
const EXT_IDS = new Set(ISO_SYMBOL_EXTENSIONS.map((s) => s.id));
const MERGED_SYMBOL_DEFS = [
  ...BASE_SYMBOLS.filter((s) => !EXT_IDS.has(s.id)),
  ...ISO_SYMBOL_EXTENSIONS,
];

const CATEGORY_META = {
  instrument: {
    label: 'Instruments',
    shortLabel: 'Instr',
    defaultColor: '#F39C12',
    defaultStroke: 2,
    icon: 'IN',
    tools: [
      { id: 'circle', label: 'Bubble', shortcut: 'C' },
      { id: 'pin', label: 'Tag Point', shortcut: 'P' },
    ],
  },
  valve: {
    label: 'Valves',
    shortLabel: 'Valve',
    defaultColor: '#E74C3C',
    defaultStroke: 2,
    icon: 'VL',
    tools: [{ id: 'line', label: 'Line', shortcut: 'L' }],
  },
  pump: {
    label: 'Pumps & Compressors',
    shortLabel: 'Pump',
    defaultColor: '#3BE494',
    defaultStroke: 2,
    icon: 'PU',
    tools: [{ id: 'line', label: 'Line', shortcut: 'L' }],
  },
  equipment: {
    label: 'Equipment',
    shortLabel: 'Equip',
    defaultColor: '#3BE494',
    defaultStroke: 2,
    icon: 'EQ',
    tools: [
      { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
      { id: 'circle', label: 'Circle', shortcut: 'C' },
    ],
  },
  piping: {
    label: 'Piping Fittings',
    shortLabel: 'Pipe',
    defaultColor: '#2D33E0',
    defaultStroke: 2,
    icon: 'PF',
    tools: [{ id: 'line', label: 'Line', shortcut: 'L' }],
  },
  general: {
    label: 'General',
    shortLabel: 'Gen',
    defaultColor: '#94A3B8',
    defaultStroke: 2,
    icon: 'GN',
    tools: [
      { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
      { id: 'line', label: 'Line', shortcut: 'L' },
      { id: 'circle', label: 'Circle', shortcut: 'C' },
      { id: 'diamond', label: 'Diamond', shortcut: 'D' },
      { id: 'pin', label: 'Pin', shortcut: 'P' },
    ],
  },
};

const CATEGORY_ORDER = ['instrument', 'valve', 'pump', 'equipment', 'piping', 'general'];

function buildStaticSymbolsByCategory() {
  const byCategory = new Map(CATEGORY_ORDER.map((id) => [id, []]));
  for (const sym of MERGED_SYMBOL_DEFS) {
    const list = byCategory.get(sym.category) || byCategory.get('general');
    list.push({
      id: sym.id,
      label: sym.label,
      abbr: sym.abbr,
      keywords: [...(sym.keywords || []), 'iso', '15519', sym.abbr?.toLowerCase()],
      source: 'iso-15519-2',
      renderType: 'vector',
      elements: getIsoGraphics(sym.id, sym.abbr),
    });
  }
  return byCategory;
}

function toCatalogEntry(custom) {
  const categoryId = custom.categoryId || custom.category || 'general';
  return {
    id: custom.id,
    label: custom.label,
    abbr: custom.abbr || custom.label?.slice(0, 6)?.toUpperCase() || 'SYM',
    keywords: [...(custom.keywords || []), 'custom', custom.abbr?.toLowerCase()].filter(Boolean),
    source: 'custom',
    renderType: 'raster',
    imageUrl: custom.imageUrl,
    elements: null,
    categoryId,
  };
}

let _customSymbols = [];
let _symbolById = new Map();
let _categoryBySymbolId = new Map();
export const PID_SYMBOL_CATEGORIES = [];
let _catalogVersion = 0;

function rebuildCatalog() {
  const staticByCategory = buildStaticSymbolsByCategory();
  const mergedByCategory = new Map(CATEGORY_ORDER.map((id) => [id, [...(staticByCategory.get(id) || [])]]));

  for (const custom of _customSymbols) {
    const entry = toCatalogEntry(custom);
    const catId = entry.categoryId;
    const list = mergedByCategory.get(catId) || mergedByCategory.get('general');
    const existingIdx = list.findIndex((s) => s.id === entry.id);
    if (existingIdx >= 0) list[existingIdx] = entry;
    else list.push(entry);
  }

  _symbolById = new Map();
  _categoryBySymbolId = new Map();
  const nextCategories = CATEGORY_ORDER.map((id) => ({
    id,
    ...CATEGORY_META[id],
    symbols: mergedByCategory.get(id) || [],
  }));

  PID_SYMBOL_CATEGORIES.length = 0;
  for (const cat of nextCategories) PID_SYMBOL_CATEGORIES.push(cat);

  for (const cat of PID_SYMBOL_CATEGORIES) {
    for (const sym of cat.symbols || []) {
      _symbolById.set(sym.id, { ...sym, categoryId: cat.id });
      _categoryBySymbolId.set(sym.id, cat.id);
    }
  }
  _catalogVersion += 1;
}

rebuildCatalog();

/** Inject admin-managed custom symbols (from API) into the runtime catalog. */
export function setCustomPidSymbols(customList = []) {
  _customSymbols = customList.filter((s) => s?.id && s.isActive !== false && s.imageUrl);
  rebuildCatalog();
}

export function getCatalogVersion() {
  return _catalogVersion;
}

export function getPidSymbol(id) {
  return _symbolById.get(id) || null;
}

export function getSymbolCategoryId(symbolId) {
  return _categoryBySymbolId.get(symbolId) || null;
}

export function getAllPidSymbols() {
  return [..._symbolById.values()];
}

export function getSymbolCatalogStats() {
  const all = getAllPidSymbols();
  const byCat = {};
  let customCount = 0;
  for (const s of all) {
    byCat[s.categoryId] = (byCat[s.categoryId] || 0) + 1;
    if (s.source === 'custom') customCount += 1;
  }
  return { total: all.length, byCategory: byCat, customCount };
}

export function searchPidSymbols(query = '', categoryId = 'all') {
  const q = query.trim().toLowerCase();
  let pool = getAllPidSymbols();
  if (categoryId && categoryId !== 'all') {
    pool = pool.filter((s) => s.categoryId === categoryId);
  }
  if (!q) return pool;
  return pool.filter((s) => {
    const hay = [
      s.label,
      s.abbr,
      s.id.replace(/^sym_/, '').replace(/_/g, ' '),
      ...(s.keywords || []),
    ].join(' ').toLowerCase();
    return hay.includes(q) || q.split(/\s+/).every((w) => hay.includes(w));
  });
}

export function getSymbolPickerCategories() {
  return PID_SYMBOL_CATEGORIES.filter((c) => (c.symbols?.length || 0) > 0);
}

export const ANNOTATION_CATEGORIES_FROM_CATALOG = PID_SYMBOL_CATEGORIES;
