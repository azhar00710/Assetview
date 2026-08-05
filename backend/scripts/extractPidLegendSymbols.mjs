/**
 * Extract symbol PNGs from eDraw P&ID legend page-1.png.
 * Run: cd backend && npm run extract:pid-symbols
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(BACKEND, '..', 'frontend');
const SHEET = join(FRONTEND, 'public/pid-legend/page-1.png');
const OUT = join(FRONTEND, 'public/pid-symbols');
const MANIFEST_OUT = join(FRONTEND, 'src/components/pnid/smartIdent/pidSymbolSprites.json');

mkdirSync(OUT, { recursive: true });

const CW = 325;
const iBox = (col, y, w = 64, h = 56) => [col * CW + 12, y, w, h];
const eBox = (col, y, w = 80, h = 80) => [col * CW + 5, y, w, h];

const SYMBOLS = [
  { id: 'sym_lc', label: 'Level Controller', abbr: 'LC', category: 'instrument', keywords: ['level', 'controller'], box: iBox(2, 398) },
  { id: 'sym_pt', label: 'Pressure Transmitter', abbr: 'PT', category: 'instrument', keywords: ['pressure', 'transmitter'], box: iBox(2, 438) },
  { id: 'sym_pi', label: 'Pressure Indicator', abbr: 'PI', category: 'instrument', keywords: ['pressure', 'indicator'], box: iBox(2, 458) },
  { id: 'sym_pc', label: 'Pressure Controller', abbr: 'PC', category: 'instrument', keywords: ['pressure', 'controller'], box: iBox(2, 608) },
  { id: 'sym_pic', label: 'Pressure Indicating Controller', abbr: 'PIC', category: 'instrument', keywords: ['pressure', 'controller'], box: iBox(2, 668) },
  { id: 'sym_pr', label: 'Pressure Recorder', abbr: 'PR', category: 'instrument', keywords: ['pressure', 'recorder'], box: iBox(2, 778) },
  { id: 'sym_ti', label: 'Temperature Indicator', abbr: 'TI', category: 'instrument', keywords: ['temperature', 'indicator'], box: iBox(1, 698) },
  { id: 'sym_tt', label: 'Temperature Transmitter', abbr: 'TT', category: 'instrument', keywords: ['temperature', 'transmitter'], box: iBox(1, 768) },
  { id: 'sym_tc', label: 'Temperature Controller', abbr: 'TC', category: 'instrument', keywords: ['temperature', 'controller'], box: iBox(1, 868) },
  { id: 'sym_tr', label: 'Temperature Recorder', abbr: 'TR', category: 'instrument', keywords: ['temperature', 'recorder'], box: iBox(1, 898) },
  { id: 'sym_fi', label: 'Flow Indicator', abbr: 'FI', category: 'instrument', keywords: ['flow', 'indicator'], box: iBox(1, 1038) },
  { id: 'sym_ft', label: 'Flow Transmitter', abbr: 'FT', category: 'instrument', keywords: ['flow', 'transmitter'], box: iBox(1, 1100) },
  { id: 'sym_fr', label: 'Flow Recorder', abbr: 'FR', category: 'instrument', keywords: ['flow', 'recorder'], box: iBox(1, 1168) },
  { id: 'sym_fc', label: 'Flow Controller', abbr: 'FC', category: 'instrument', keywords: ['flow', 'controller'], box: iBox(1, 1288) },
  { id: 'sym_fe', label: 'Flow Element', abbr: 'FE', category: 'instrument', keywords: ['flow', 'element', 'orifice'], box: iBox(2, 908) },
  { id: 'sym_li', label: 'Level Indicator', abbr: 'LI', category: 'instrument', keywords: ['level', 'indicator'], box: iBox(1, 1350) },
  { id: 'sym_lt', label: 'Level Transmitter', abbr: 'LT', category: 'instrument', keywords: ['level', 'transmitter'], box: iBox(1, 1490) },
  { id: 'sym_lr', label: 'Level Recorder', abbr: 'LR', category: 'instrument', keywords: ['level', 'recorder'], box: iBox(1, 1570) },
  { id: 'sym_lg', label: 'Level Gauge', abbr: 'LG', category: 'instrument', keywords: ['level', 'gauge'], box: iBox(2, 1078) },
  { id: 'sym_at', label: 'Analyzer Transmitter', abbr: 'AT', category: 'instrument', keywords: ['analyzer', 'transmitter'], box: iBox(2, 1178) },

  { id: 'sym_gate_valve', label: 'Hand-Operated Gate Valve', abbr: 'GV', category: 'valve', keywords: ['gate', 'valve', 'hand'], box: eBox(0, 1760, 90, 50) },
  { id: 'sym_check_valve', label: 'Check Valve', abbr: 'CKV', category: 'valve', keywords: ['check', 'non-return'], box: eBox(1, 1755) },
  { id: 'sym_solenoid_valve', label: 'Solenoid Valve', abbr: 'SV', category: 'valve', keywords: ['solenoid'], box: eBox(2, 1755) },
  { id: 'sym_3way_valve', label: '4-Way Plug Valve', abbr: '4V', category: 'valve', keywords: ['four', 'way', 'plug'], box: eBox(3, 1755) },
  { id: 'sym_pinch_valve', label: 'Pinch Valve', abbr: 'PV', category: 'valve', keywords: ['pinch'], box: eBox(4, 1755) },
  { id: 'sym_globe_valve', label: 'Hand-Operated Globe Valve', abbr: 'GLV', category: 'valve', keywords: ['globe', 'valve'], box: eBox(0, 1810) },
  { id: 'sym_ball_valve', label: 'Flanged Valve', abbr: 'BV', category: 'valve', keywords: ['ball', 'flanged'], box: eBox(1, 1810) },
  { id: 'sym_motor_valve', label: 'Motor-Operated Valve', abbr: 'MOV', category: 'valve', keywords: ['motor', 'operated'], box: eBox(2, 1888) },
  { id: 'sym_plug_valve', label: 'Pilot Gate Valve', abbr: 'PLG', category: 'valve', keywords: ['plug', 'pilot'], box: eBox(2, 1980) },
  { id: 'sym_control_valve', label: 'Balanced Diaphragm Gate Valve', abbr: 'CV', category: 'valve', keywords: ['control', 'diaphragm'], box: eBox(3, 1888) },
  { id: 'sym_angle_valve', label: 'Angle Valve', abbr: 'AV', category: 'valve', keywords: ['angle'], box: eBox(1, 1980) },
  { id: 'sym_safety_valve', label: 'Relief Valve', abbr: 'PSV', category: 'valve', keywords: ['safety', 'relief', 'psv'], box: eBox(3, 1980) },
  { id: 'sym_butterfly_valve', label: 'Butterfly Valve', abbr: 'BFV', category: 'valve', keywords: ['butterfly'], box: eBox(4, 11158, 80, 50) },
  { id: 'sym_needle_valve', label: 'Needle Valve', abbr: 'NV', category: 'valve', keywords: ['needle'], box: eBox(0, 2095) },
  { id: 'sym_diaphragm_valve', label: 'Rotary Valve', abbr: 'RV', category: 'valve', keywords: ['diaphragm', 'rotary'], box: eBox(4, 2095) },

  { id: 'sym_compressor', label: 'Compressor', abbr: 'K', category: 'pump', keywords: ['compressor'], box: eBox(0, 2705) },
  { id: 'sym_fan', label: 'Fan / Blower', abbr: 'FN', category: 'pump', keywords: ['fan', 'blower'], box: eBox(1, 2705) },
  { id: 'sym_pump', label: 'Centrifugal Pump', abbr: 'P', category: 'pump', keywords: ['centrifugal', 'pump'], box: eBox(1, 2795) },
  { id: 'sym_pump_vertical', label: 'Vertical Pump', abbr: 'VPU', category: 'pump', keywords: ['vertical'], box: eBox(0, 2795) },
  { id: 'sym_pump_reciprocating', label: 'Reciprocating Pump', abbr: 'RP', category: 'pump', keywords: ['reciprocating'], box: eBox(0, 2888) },
  { id: 'sym_pump_centrifugal2', label: 'Centrifugal Pump 2', abbr: 'P2', category: 'pump', keywords: ['centrifugal'], box: eBox(2, 2795) },
  { id: 'sym_pump_positive', label: 'Positive Displacement Pump', abbr: 'PD', category: 'pump', keywords: ['positive', 'displacement'], box: eBox(2, 2888) },
  { id: 'sym_pump_vacuum', label: 'Vacuum Pump', abbr: 'VP', category: 'pump', keywords: ['vacuum'], box: eBox(2, 2978) },
  { id: 'sym_pump_gear', label: 'Gear Pump', abbr: 'GP', category: 'pump', keywords: ['gear'], box: eBox(4, 2888) },
  { id: 'sym_pump_screw', label: 'Screw Pump', abbr: 'SP', category: 'pump', keywords: ['screw'], box: eBox(3, 2978) },
  { id: 'sym_motor', label: 'Motor', abbr: 'M', category: 'equipment', keywords: ['motor', 'diesel'], box: eBox(4, 2705) },

  { id: 'sym_column', label: 'Fluidized Bed Column', abbr: 'COL', category: 'equipment', keywords: ['column', 'tower'], box: eBox(0, 4228, 72, 110) },
  { id: 'sym_vessel_v', label: 'Vertical Vessel', abbr: 'V-V', category: 'equipment', keywords: ['vessel', 'vertical'], box: eBox(1, 4058, 72, 110) },
  { id: 'sym_tank', label: 'Tank', abbr: 'TK', category: 'equipment', keywords: ['tank', 'barrel'], box: eBox(2, 4058, 72, 110) },
  { id: 'sym_he_plate', label: 'Cone Roof Tank', abbr: 'CRT', category: 'equipment', keywords: ['cone', 'tank', 'roof'], box: eBox(3, 4058, 72, 110) },
  { id: 'sym_tank_floating', label: 'Internal Floating Roof Tank', abbr: 'FRT', category: 'equipment', keywords: ['floating', 'roof'], box: eBox(3, 4228, 72, 110) },
  { id: 'sym_vessel_h', label: 'Pit Vessel', abbr: 'V-H', category: 'equipment', keywords: ['vessel', 'horizontal', 'pit'], box: eBox(4, 4228, 100, 72) },
  { id: 'sym_mixer', label: 'Mixing Vessel', abbr: 'MX', category: 'equipment', keywords: ['mixer', 'agitator'], box: eBox(0, 3908, 72, 110) },
  { id: 'sym_separator', label: 'Separator', abbr: 'SEP', category: 'equipment', keywords: ['separator', 'knockout'], box: eBox(3, 10658) },
  { id: 'sym_filter', label: 'Filter', abbr: 'FL', category: 'equipment', keywords: ['filter', 'strainer'], box: eBox(1, 4710, 72, 90) },
  { id: 'sym_reactor', label: 'Products Vessel', abbr: 'RX', category: 'equipment', keywords: ['reactor', 'vessel'], box: eBox(4, 3908, 72, 110) },
  { id: 'sym_heat_exchanger', label: 'Heat Exchanger', abbr: 'HX', category: 'equipment', keywords: ['heat', 'exchanger'], box: eBox(1, 6120) },
  { id: 'sym_cooling_tower', label: 'Cooling Tower', abbr: 'CT', category: 'equipment', keywords: ['cooling', 'tower'], box: eBox(1, 6010, 72, 90) },
  { id: 'sym_fired_heater', label: 'Combustion Chamber', abbr: 'FH', category: 'equipment', keywords: ['fired', 'heater', 'furnace'], box: eBox(4, 6530) },

  { id: 'sym_tee', label: 'Top-Bottom', abbr: 'TEE', category: 'piping', keywords: ['tee', 'branch'], box: iBox(0, 11205) },
  { id: 'sym_elbow', label: 'Sleeve Joint', abbr: 'ELB', category: 'piping', keywords: ['elbow', 'bend'], box: iBox(1, 11205) },
  { id: 'sym_reducer', label: 'Reducer', abbr: 'RED', category: 'piping', keywords: ['reducer'], box: iBox(2, 11678) },
  { id: 'sym_flange', label: 'Flange', abbr: 'FLG', category: 'piping', keywords: ['flange'], box: iBox(2, 11078) },
  { id: 'sym_spectacle', label: 'Spectacle Blind', abbr: 'SB', category: 'piping', keywords: ['spectacle', 'blind'], box: iBox(1, 11888) },
  { id: 'sym_union', label: 'Union', abbr: 'UN', category: 'piping', keywords: ['union'], box: iBox(2, 11148) },
  { id: 'sym_expansion', label: 'Compensate', abbr: 'EJ', category: 'piping', keywords: ['expansion'], box: iBox(4, 11498) },
  { id: 'sym_strainer', label: 'Y-Strainer', abbr: 'YS', category: 'piping', keywords: ['strainer'], box: iBox(0, 11718) },
  { id: 'sym_orifice_plate', label: 'Orifice Plate', abbr: 'ORF', category: 'piping', keywords: ['orifice', 'plate'], box: iBox(2, 11348) },
  { id: 'sym_blind_flange', label: 'Bell Mouth', abbr: 'BM', category: 'piping', keywords: ['blind', 'bell'], box: iBox(4, 10818) },
  { id: 'sym_steam_trap', label: 'Flame Arrester', abbr: 'FA', category: 'piping', keywords: ['flame', 'arrester'], box: iBox(3, 10818, 72, 90) },
];

const sheet = readFileSync(SHEET);
const meta = await sharp(sheet).metadata();
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
  console.log('✓', sym.abbr);
}

writeFileSync(MANIFEST_OUT, JSON.stringify({
  legendPdf: '/pid-legend/pid-legend.pdf',
  legendSheet: '/pid-legend/page-1.png',
  legendUrl: 'https://www.edrawsoft.com/pid/images/pid-legend.pdf',
  sheetSize: { width: meta.width, height: meta.height },
  symbolCount: manifest.length,
  symbols: manifest,
}, null, 2));

console.log(`Extracted ${manifest.length} symbols`);
