/**
 * Extract symbol PNGs from eDraw P&ID legend (page-1.png).
 * Source PDF: https://www.edrawsoft.com/pid/images/pid-legend.pdf
 *
 * Run from frontend/: node scripts/extractLegendSymbols.mjs
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'public/pid-legend/page-1.png');
const OUT = join(ROOT, 'public/pid-symbols');
const MANIFEST_OUT = join(ROOT, 'src/components/pnid/smartIdent/pidSymbolSprites.json');

mkdirSync(OUT, { recursive: true });

/** 5-column grid on 1625px sheet */
const CW = 325;
const box = (col, y, w = 96, h = 96) => [col * CW + 22, y, w, h];

/**
 * Calibrated crop boxes on legend page-1.png (150dpi).
 * Labels match eDraw P&ID Legend document.
 */
const SYMBOLS = [
  // ── Instruments ──
  { id: 'sym_pt', label: 'Pressure Transmitter', abbr: 'PT', category: 'instrument', keywords: ['pressure', 'transmitter'], box: box(3, 418) },
  { id: 'sym_pi', label: 'Pressure Indicator', abbr: 'PI', category: 'instrument', keywords: ['pressure', 'indicator'], box: box(2, 508) },
  { id: 'sym_pic', label: 'Pressure Indicating Controller', abbr: 'PIC', category: 'instrument', keywords: ['pressure', 'controller'], box: box(3, 598) },
  { id: 'sym_pc', label: 'Pressure Controller', abbr: 'PC', category: 'instrument', keywords: ['pressure', 'controller'], box: box(3, 508) },
  { id: 'sym_pr', label: 'Pressure Recorder', abbr: 'PR', category: 'instrument', keywords: ['pressure', 'recorder'], box: box(2, 598) },
  { id: 'sym_tt', label: 'Temperature Transmitter', abbr: 'TT', category: 'instrument', keywords: ['temperature', 'transmitter'], box: box(4, 688) },
  { id: 'sym_ti', label: 'Temperature Indicator', abbr: 'TI', category: 'instrument', keywords: ['temperature', 'indicator'], box: box(3, 688) },
  { id: 'sym_tc', label: 'Temperature Controller', abbr: 'TC', category: 'instrument', keywords: ['temperature', 'controller'], box: box(4, 778) },
  { id: 'sym_tr', label: 'Temperature Recorder', abbr: 'TR', category: 'instrument', keywords: ['temperature', 'recorder'], box: box(3, 778) },
  { id: 'sym_ft', label: 'Flow Transmitter', abbr: 'FT', category: 'instrument', keywords: ['flow', 'transmitter'], box: box(0, 868) },
  { id: 'sym_fi', label: 'Flow Indicator', abbr: 'FI', category: 'instrument', keywords: ['flow', 'indicator'], box: box(1, 868) },
  { id: 'sym_fc', label: 'Flow Controller', abbr: 'FC', category: 'instrument', keywords: ['flow', 'controller'], box: box(2, 868) },
  { id: 'sym_fr', label: 'Flow Recorder', abbr: 'FR', category: 'instrument', keywords: ['flow', 'recorder'], box: box(3, 868) },
  { id: 'sym_fe', label: 'Flow Element', abbr: 'FE', category: 'instrument', keywords: ['flow', 'element', 'orifice'], box: box(4, 958) },
  { id: 'sym_lt', label: 'Level Transmitter', abbr: 'LT', category: 'instrument', keywords: ['level', 'transmitter'], box: box(2, 1495) },
  { id: 'sym_li', label: 'Level Indicator', abbr: 'LI', category: 'instrument', keywords: ['level', 'indicator'], box: box(1, 1495) },
  { id: 'sym_lc', label: 'Level Controller', abbr: 'LC', category: 'instrument', keywords: ['level', 'controller'], box: box(2, 338) },
  { id: 'sym_lr', label: 'Level Recorder', abbr: 'LR', category: 'instrument', keywords: ['level', 'recorder'], box: box(2, 1588) },
  { id: 'sym_la', label: 'Level Alarm', abbr: 'LA', category: 'instrument', keywords: ['level', 'alarm'], box: box(0, 1495) },
  { id: 'sym_at', label: 'Analyzer Transmitter', abbr: 'AT', category: 'instrument', keywords: ['analyzer', 'transmitter'], box: box(4, 1398) },
  { id: 'sym_lg', label: 'Level Gauge', abbr: 'LG', category: 'instrument', keywords: ['level', 'gauge'], box: box(3, 1398) },

  // ── Valves ──
  { id: 'sym_gate_valve', label: 'Hand-Operated Gate Valve', abbr: 'GV', category: 'valve', keywords: ['gate', 'valve', 'hand'], box: box(0, 1668) },
  { id: 'sym_check_valve', label: 'Check Valve', abbr: 'CKV', category: 'valve', keywords: ['check', 'non-return'], box: box(1, 1668) },
  { id: 'sym_solenoid_valve', label: 'Solenoid Valve', abbr: 'SV', category: 'valve', keywords: ['solenoid'], box: box(2, 1668) },
  { id: 'sym_3way_valve', label: '4-Way Plug Valve', abbr: '4V', category: 'valve', keywords: ['four', 'way', 'plug'], box: box(3, 1668) },
  { id: 'sym_pinch_valve', label: 'Pinch Valve', abbr: 'PV', category: 'valve', keywords: ['pinch'], box: box(4, 1668) },
  { id: 'sym_globe_valve', label: 'Hand-Operated Globe Valve', abbr: 'GLV', category: 'valve', keywords: ['globe', 'valve'], box: box(1, 1786) },
  { id: 'sym_ball_valve', label: 'Flanged Valve', abbr: 'BV', category: 'valve', keywords: ['ball', 'flanged'], box: box(1, 1786) },
  { id: 'sym_butterfly_valve', label: 'Butterfly Valve', abbr: 'BFV', category: 'valve', keywords: ['butterfly'], box: box(1, 1904) },
  { id: 'sym_motor_valve', label: 'Motor-Operated Valve', abbr: 'MOV', category: 'valve', keywords: ['motor', 'operated'], box: box(2, 1904) },
  { id: 'sym_control_valve', label: 'Balanced Diaphragm Gate Valve', abbr: 'CV', category: 'valve', keywords: ['control', 'diaphragm'], box: box(4, 1904) },
  { id: 'sym_plug_valve', label: 'Pilot Gate Valve', abbr: 'PLG', category: 'valve', keywords: ['plug', 'pilot'], box: box(3, 1904) },
  { id: 'sym_angle_valve', label: 'Angle Valve', abbr: 'AV', category: 'valve', keywords: ['angle'], box: box(1, 2022) },
  { id: 'sym_safety_valve', label: 'Relief Valve', abbr: 'PSV', category: 'valve', keywords: ['safety', 'relief', 'psv'], box: box(2, 2022) },
  { id: 'sym_needle_valve', label: 'Needle Valve', abbr: 'NV', category: 'valve', keywords: ['needle'], box: box(1, 2058) },
  { id: 'sym_diaphragm_valve', label: 'Rotary Valve', abbr: 'RV', category: 'valve', keywords: ['diaphragm', 'rotary'], box: box(0, 2058) },

  // ── Pumps & compressors ──
  { id: 'sym_pump', label: 'Centrifugal Pump', abbr: 'P', category: 'pump', keywords: ['centrifugal', 'pump'], box: box(1, 2718) },
  { id: 'sym_pump_centrifugal2', label: 'Centrifugal Pump 2', abbr: 'P2', category: 'pump', keywords: ['centrifugal'], box: box(2, 2836) },
  { id: 'sym_pump_positive', label: 'Positive Displacement Pump', abbr: 'PD', category: 'pump', keywords: ['positive', 'displacement'], box: box(3, 2836) },
  { id: 'sym_pump_gear', label: 'Gear Pump', abbr: 'GP', category: 'pump', keywords: ['gear'], box: box(4, 2954) },
  { id: 'sym_pump_reciprocating', label: 'Reciprocating Pump', abbr: 'RP', category: 'pump', keywords: ['reciprocating'], box: box(0, 2836) },
  { id: 'sym_pump_screw', label: 'Screw Pump', abbr: 'SP', category: 'pump', keywords: ['screw'], box: box(3, 3072) },
  { id: 'sym_pump_vacuum', label: 'Vacuum Pump', abbr: 'VP', category: 'pump', keywords: ['vacuum'], box: box(2, 3072) },
  { id: 'sym_pump_vertical', label: 'Vertical Pump', abbr: 'VPU', category: 'pump', keywords: ['vertical'], box: box(0, 2718) },
  { id: 'sym_fan', label: 'Fan / Blower', abbr: 'FN', category: 'pump', keywords: ['fan', 'blower', 'axial'], box: box(1, 2588) },
  { id: 'sym_compressor', label: 'Compressor', abbr: 'K', category: 'pump', keywords: ['compressor'], box: box(0, 2588) },

  // ── Vessels & equipment ──
  { id: 'sym_column', label: 'Fluidized Bed Column', abbr: 'COL', category: 'equipment', keywords: ['column', 'tower', 'fluidized'], box: box(0, 4238) },
  { id: 'sym_vessel_v', label: 'Bag (ISO) / Vertical Vessel', abbr: 'V-V', category: 'equipment', keywords: ['vessel', 'vertical', 'bag'], box: box(1, 4238) },
  { id: 'sym_tank', label: 'Tank', abbr: 'TK', category: 'equipment', keywords: ['tank', 'barrel'], box: box(2, 4238, 96, 110) },
  { id: 'sym_tank_floating', label: 'Internal Floating Roof Tank', abbr: 'FRT', category: 'equipment', keywords: ['floating', 'roof'], box: box(4, 4238, 96, 110) },
  { id: 'sym_vessel_h', label: 'Pit Vessel', abbr: 'V-H', category: 'equipment', keywords: ['vessel', 'horizontal', 'pit'], box: box(4, 4356, 110, 80) },
  { id: 'sym_heat_exchanger', label: 'Electrical Heating Vessel', abbr: 'HX', category: 'equipment', keywords: ['heat', 'exchanger', 'heater'], box: box(4, 4356) },
  { id: 'sym_he_plate', label: 'Cone Roof Tank', abbr: 'PHX', category: 'equipment', keywords: ['plate', 'cone'], box: box(3, 4238) },
  { id: 'sym_separator', label: 'Tank 3', abbr: 'SEP', category: 'equipment', keywords: ['separator', 'knockout'], box: box(3, 4356, 96, 110) },
  { id: 'sym_filter', label: 'Filter', abbr: 'FL', category: 'equipment', keywords: ['filter', 'strainer'], box: box(0, 4580) },
  { id: 'sym_mixer', label: 'Mixer', abbr: 'MX', category: 'equipment', keywords: ['mixer', 'agitator'], box: box(1, 4700) },
  { id: 'sym_motor', label: 'Motor', abbr: 'M', category: 'equipment', keywords: ['motor', 'diesel'], box: box(4, 2718) },
  { id: 'sym_reactor', label: 'Reactor', abbr: 'RX', category: 'equipment', keywords: ['reactor'], box: box(2, 4580) },
  { id: 'sym_cooling_tower', label: 'Cooling Tower', abbr: 'CT', category: 'equipment', keywords: ['cooling', 'tower'], box: box(3, 4820) },
  { id: 'sym_fired_heater', label: 'Furnace', abbr: 'FH', category: 'equipment', keywords: ['fired', 'heater', 'furnace'], box: box(0, 4820) },

  // ── Piping & fittings ──
  { id: 'sym_tee', label: 'Top to Top', abbr: 'TEE', category: 'piping', keywords: ['tee', 'branch', 'top'], box: box(0, 11720) },
  { id: 'sym_elbow', label: 'Sleeve Joint', abbr: 'ELB', category: 'piping', keywords: ['elbow', 'bend'], box: box(1, 11720) },
  { id: 'sym_reducer', label: 'Socket Weld', abbr: 'RED', category: 'piping', keywords: ['reducer', 'socket'], box: box(2, 11720) },
  { id: 'sym_flange', label: 'Triangle Separator', abbr: 'FLG', category: 'piping', keywords: ['flange', 'separator'], box: box(3, 11720) },
  { id: 'sym_spectacle', label: 'Breakthrough', abbr: 'SB', category: 'piping', keywords: ['spectacle', 'blind'], box: box(4, 11720) },
  { id: 'sym_union', label: 'Orifice', abbr: 'UN', category: 'piping', keywords: ['union', 'orifice'], box: box(4, 11838) },
  { id: 'sym_expansion', label: 'Expansion Joint', abbr: 'EJ', category: 'piping', keywords: ['expansion', 'bellows'], box: box(0, 11956) },
  { id: 'sym_strainer', label: 'Y-Strainer', abbr: 'YS', category: 'piping', keywords: ['strainer'], box: box(1, 11956) },
  { id: 'sym_orifice_plate', label: 'Orifice Plate', abbr: 'ORF', category: 'piping', keywords: ['orifice', 'plate'], box: box(4, 11838) },
  { id: 'sym_blind_flange', label: 'Bell Mouth', abbr: 'BF', category: 'piping', keywords: ['blind', 'bell'], box: box(4, 10820) },
  { id: 'sym_steam_trap', label: 'Flame Arrester', abbr: 'ST', category: 'piping', keywords: ['steam', 'trap', 'flame'], box: box(3, 10820) },
];

const sheet = readFileSync(SHEET);
const meta = await sharp(sheet).metadata();
console.log(`Legend sheet: ${meta.width}×${meta.height}px`);

const manifest = [];

for (const sym of SYMBOLS) {
  const [x, y, w, h] = sym.box;
  const outFile = `${sym.id}.png`;
  await sharp(sheet)
    .extract({
      left: Math.max(0, x),
      top: Math.max(0, y),
      width: Math.min(w, meta.width - x),
      height: Math.min(h, meta.height - y),
    })
    .trim({ threshold: 12 })
    .extend({
      top: 6, bottom: 6, left: 6, right: 6,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toFile(join(OUT, outFile));

  manifest.push({
    id: sym.id,
    label: sym.label,
    abbr: sym.abbr,
    category: sym.category,
    keywords: sym.keywords,
    image: `/pid-symbols/${outFile}`,
    source: 'edraw-pid-legend',
    legendBox: sym.box,
  });
  console.log('✓', sym.abbr, sym.label);
}

writeFileSync(MANIFEST_OUT, JSON.stringify({
  legendPdf: '/pid-legend/pid-legend.pdf',
  legendSheet: '/pid-legend/page-1.png',
  legendUrl: 'https://www.edrawsoft.com/pid/images/pid-legend.pdf',
  sheetSize: { width: meta.width, height: meta.height },
  symbolCount: manifest.length,
  symbols: manifest,
}, null, 2));

console.log(`\nDone — ${manifest.length} symbols from eDraw legend → public/pid-symbols/`);
