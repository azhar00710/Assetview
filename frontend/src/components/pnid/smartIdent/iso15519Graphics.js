/**
 * ISO 15519-2:2015 / ISO 10628-2 graphical symbols for P&ID toolboxes.
 * Vector primitives only — transparent background, stroke outlines (no raster crops).
 */
export const ISO_VIEWBOX = 64;

/** @typedef {{ t: string, [key: string]: unknown }} IsoElement */

/** @type {IsoElement[]} */
export const BOWTIE = [
  { t: 'poly', points: [[6, 20], [6, 44], [32, 32]], fill: 'none' },
  { t: 'poly', points: [[58, 20], [58, 44], [32, 32]], fill: 'none' },
];

const HANDWHEEL = [
  { t: 'line', x1: 32, y1: 18, x2: 32, y2: 5 },
  { t: 'line', x1: 22, y1: 5, x2: 42, y2: 5 },
];

const MOTOR_ACTUATOR = [
  { t: 'rect', x: 22, y: 2, w: 20, h: 12, rx: 1, fill: 'none' },
  { t: 'line', x1: 32, y1: 14, x2: 32, y2: 18 },
];

const SOLENOID_ACTUATOR = [
  { t: 'rect', x: 22, y: 2, w: 20, h: 12, rx: 1, fill: 'none' },
  { t: 'line', x1: 32, y1: 14, x2: 32, y2: 18 },
];

const DIAPHRAGM_ACTUATOR = [
  { t: 'line', x1: 18, y1: 8, x2: 46, y2: 8 },
  { t: 'line', x1: 18, y1: 14, x2: 46, y2: 14 },
  { t: 'line', x1: 32, y1: 14, x2: 32, y2: 18 },
];

/** ISO 15519-2 PCI bubble variants (no tag text — letter codes applied at placement). */
function instrumentBubble(kind = 'field') {
  const circle = { t: 'circle', cx: 32, cy: 32, r: 21, fill: 'none' };
  switch (kind) {
    case 'control':
      return [circle, { t: 'line', x1: 10, y1: 32, x2: 54, y2: 32 }];
    case 'recorder':
      return [circle, { t: 'line', x1: 20, y1: 20, x2: 44, y2: 44 }];
    case 'element':
      return [
        circle,
        { t: 'line', x1: 32, y1: 53, x2: 32, y2: 62 },
        { t: 'line', x1: 26, y1: 58, x2: 38, y2: 58 },
      ];
    case 'gauge':
      return [
        circle,
        { t: 'line', x1: 32, y1: 14, x2: 32, y2: 20 },
        { t: 'line', x1: 32, y1: 44, x2: 32, y2: 50 },
        { t: 'line', x1: 18, y1: 32, x2: 24, y2: 32 },
        { t: 'line', x1: 40, y1: 32, x2: 46, y2: 32 },
      ];
    case 'switch':
      return [
        circle,
        { t: 'line', x1: 32, y1: 11, x2: 32, y2: 4 },
        { t: 'line', x1: 28, y1: 4, x2: 36, y2: 4 },
      ];
    case 'alarm':
      return [
        circle,
        { t: 'poly', points: [[24, 14], [40, 14], [32, 5]], fill: 'none' },
      ];
    case 'safety':
      return [
        circle,
        { t: 'line', x1: 32, y1: 11, x2: 32, y2: 4 },
        { t: 'poly', points: [[26, 48], [38, 48], [32, 54]], fill: 'none' },
      ];
    default:
      return [circle];
  }
}

function instrumentKindForAbbr(abbr) {
  const code = (abbr || '').toUpperCase();
  if (code.endsWith('E') && code.length <= 3) return 'element';
  if (code.endsWith('G')) return 'gauge';
  if (code.endsWith('R') && !code.endsWith('PRV')) return 'recorder';
  if (code.endsWith('C') || code.endsWith('IC')) return 'control';
  if (/SH$|SL$|^ZSC$|^ZSO$|^ZSH$|^ZSL$|^ZT$/.test(code)) return 'switch';
  if (/AH$|AL$/.test(code)) return 'alarm';
  if (/^PSV$|^ESD$|^SIS$/.test(code)) return 'safety';
  return 'field';
}

/** @type {Record<string, IsoElement[]>} */
export const ISO_SYMBOL_GRAPHICS = {
  // ── Instruments (ISO 15519-2 letter codes / PCI bubbles) ──
  sym_lc: instrumentBubble('control'),
  sym_pt: instrumentBubble('field'),
  sym_pi: instrumentBubble('field'),
  sym_pc: instrumentBubble('control'),
  sym_pic: instrumentBubble('control'),
  sym_pr: instrumentBubble('recorder'),
  sym_ti: instrumentBubble('field'),
  sym_tt: instrumentBubble('field'),
  sym_tc: instrumentBubble('control'),
  sym_tr: instrumentBubble('recorder'),
  sym_fi: instrumentBubble('field'),
  sym_ft: instrumentBubble('field'),
  sym_fr: instrumentBubble('recorder'),
  sym_fc: instrumentBubble('control'),
  sym_fe: instrumentBubble('element'),
  sym_li: instrumentBubble('field'),
  sym_lt: instrumentBubble('field'),
  sym_lr: instrumentBubble('recorder'),
  sym_lg: instrumentBubble('gauge'),
  sym_at: instrumentBubble('field'),

  // ── Valves (ISO 10628-2) ──
  sym_gate_valve: [...BOWTIE, ...HANDWHEEL],
  sym_check_valve: [
    ...BOWTIE,
    { t: 'poly', points: [[46, 24], [58, 32], [46, 40]], fill: 'none' },
  ],
  sym_solenoid_valve: [...BOWTIE, ...SOLENOID_ACTUATOR],
  sym_3way_valve: [
    { t: 'circle', cx: 32, cy: 32, r: 18, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 14, y2: 32 },
    { t: 'line', x1: 50, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 32, y1: 50, x2: 32, y2: 58 },
  ],
  sym_pinch_valve: [
    ...BOWTIE,
    { t: 'line', x1: 24, y1: 8, x2: 40, y2: 8 },
    { t: 'line', x1: 24, y1: 8, x2: 28, y2: 18 },
    { t: 'line', x1: 40, y1: 8, x2: 36, y2: 18 },
  ],
  sym_globe_valve: [
    ...BOWTIE,
    { t: 'circle', cx: 32, cy: 32, r: 7, fill: 'none' },
    ...HANDWHEEL,
  ],
  sym_ball_valve: [
    ...BOWTIE,
    { t: 'circle', cx: 32, cy: 32, r: 8, fill: 'none' },
  ],
  sym_motor_valve: [...BOWTIE, ...MOTOR_ACTUATOR],
  sym_plug_valve: [
    ...BOWTIE,
    { t: 'rect', x: 28, y: 26, w: 8, h: 12, fill: 'none' },
    ...HANDWHEEL,
  ],
  sym_control_valve: [...BOWTIE, ...DIAPHRAGM_ACTUATOR],
  sym_angle_valve: [
    { t: 'poly', points: [[6, 44], [6, 28], [32, 28], [32, 44]], fill: 'none' },
    { t: 'line', x1: 32, y1: 28, x2: 32, y2: 8 },
    { t: 'line', x1: 26, y1: 8, x2: 38, y2: 8 },
  ],
  sym_safety_valve: [
    ...BOWTIE,
    { t: 'poly', points: [[26, 6], [38, 6], [32, 16]], fill: 'none' },
    { t: 'line', x1: 32, y1: 16, x2: 32, y2: 18 },
  ],
  sym_butterfly_valve: [
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 32, y1: 14, x2: 32, y2: 50 },
    { t: 'line', x1: 20, y1: 20, x2: 44, y2: 44 },
    { t: 'line', x1: 44, y1: 20, x2: 20, y2: 44 },
  ],
  sym_needle_valve: [
    ...BOWTIE,
    { t: 'line', x1: 32, y1: 18, x2: 32, y2: 6 },
    { t: 'line', x1: 32, y1: 6, x2: 38, y2: 12 },
  ],
  sym_diaphragm_valve: [
    ...BOWTIE,
    { t: 'line', x1: 20, y1: 10, x2: 44, y2: 10 },
    { t: 'line', x1: 20, y1: 16, x2: 44, y2: 16 },
    { t: 'line', x1: 32, y1: 16, x2: 32, y2: 18 },
  ],

  // ── Pumps & compressors (ISO 10628-2) ──
  sym_compressor: [
    { t: 'circle', cx: 28, cy: 32, r: 18, fill: 'none' },
    { t: 'poly', points: [[46, 32], [58, 24], [58, 40]], fill: 'none' },
  ],
  sym_fan: [
    { t: 'circle', cx: 32, cy: 32, r: 18, fill: 'none' },
    { t: 'line', x1: 32, y1: 14, x2: 32, y2: 50 },
    { t: 'line', x1: 14, y1: 32, x2: 50, y2: 32 },
    { t: 'line', x1: 19, y1: 19, x2: 45, y2: 45 },
    { t: 'line', x1: 45, y1: 19, x2: 19, y2: 45 },
  ],
  sym_pump: [
    { t: 'circle', cx: 26, cy: 32, r: 16, fill: 'none' },
    { t: 'poly', points: [[42, 32], [56, 22], [56, 42]], fill: 'none' },
  ],
  sym_pump_vertical: [
    { t: 'circle', cx: 32, cy: 36, r: 14, fill: 'none' },
    { t: 'line', x1: 32, y1: 8, x2: 32, y2: 22 },
    { t: 'poly', points: [[32, 50], [24, 58], [40, 58]], fill: 'none' },
  ],
  sym_pump_reciprocating: [
    { t: 'rect', x: 14, y: 22, w: 28, h: 20, fill: 'none' },
    { t: 'line', x1: 42, y1: 32, x2: 56, y2: 32 },
    { t: 'line', x1: 28, y1: 22, x2: 28, y2: 10 },
    { t: 'line', x1: 22, y1: 10, x2: 34, y2: 10 },
  ],
  sym_pump_centrifugal2: [
    { t: 'circle', cx: 30, cy: 32, r: 14, fill: 'none' },
    { t: 'poly', points: [[44, 32], [56, 26], [56, 38]], fill: 'none' },
    { t: 'line', x1: 30, y1: 18, x2: 30, y2: 8 },
  ],
  sym_pump_positive: [
    { t: 'circle', cx: 28, cy: 32, r: 14, fill: 'none' },
    { t: 'rect', x: 42, y: 24, w: 14, h: 16, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 14, y2: 32 },
  ],
  sym_pump_vacuum: [
    { t: 'circle', cx: 28, cy: 32, r: 14, fill: 'none' },
    { t: 'poly', points: [[42, 32], [54, 26], [54, 38]], fill: 'none' },
    { t: 'line', x1: 20, y1: 20, x2: 36, y2: 36 },
    { t: 'line', x1: 36, y1: 20, x2: 20, y2: 36 },
  ],
  sym_pump_gear: [
    { t: 'circle', cx: 24, cy: 32, r: 10, fill: 'none' },
    { t: 'circle', cx: 40, cy: 32, r: 10, fill: 'none' },
    { t: 'rect', x: 10, y: 26, w: 44, h: 12, fill: 'none' },
  ],
  sym_pump_screw: [
    { t: 'rect', x: 12, y: 26, w: 40, h: 12, fill: 'none' },
    { t: 'path', d: 'M16 26 L20 38 M24 26 L28 38 M32 26 L36 38 M40 26 L44 38', fill: 'none' },
  ],
  sym_motor: [
    { t: 'circle', cx: 32, cy: 32, r: 20, fill: 'none' },
    { t: 'line', x1: 32, y1: 12, x2: 32, y2: 52 },
    { t: 'line', x1: 12, y1: 32, x2: 52, y2: 32 },
  ],

  // ── Equipment ──
  sym_column: [
    { t: 'rect', x: 22, y: 6, w: 20, h: 52, fill: 'none' },
    { t: 'line', x1: 24, y1: 18, x2: 40, y2: 18 },
    { t: 'line', x1: 24, y1: 32, x2: 40, y2: 32 },
    { t: 'line', x1: 24, y1: 46, x2: 40, y2: 46 },
  ],
  sym_vessel_v: [
    { t: 'path', d: 'M22 10 L22 54 Q32 58 42 54 L42 10 Q32 6 22 10 Z', fill: 'none' },
  ],
  sym_tank: [
    { t: 'rect', x: 10, y: 28, w: 44, h: 24, fill: 'none' },
    { t: 'line', x1: 10, y1: 34, x2: 54, y2: 34 },
  ],
  sym_he_plate: [
    { t: 'rect', x: 10, y: 30, w: 44, h: 20, fill: 'none' },
    { t: 'path', d: 'M10 30 L32 14 L54 30', fill: 'none' },
  ],
  sym_tank_floating: [
    { t: 'rect', x: 12, y: 20, w: 40, h: 36, fill: 'none' },
    { t: 'line', x1: 12, y1: 32, x2: 52, y2: 32 },
  ],
  sym_vessel_h: [
    { t: 'path', d: 'M10 32 L14 24 L50 24 L54 32 L50 40 L14 40 Z', fill: 'none' },
  ],
  sym_mixer: [
    { t: 'rect', x: 20, y: 16, w: 24, h: 40, fill: 'none' },
    { t: 'line', x1: 32, y1: 6, x2: 32, y2: 16 },
    { t: 'line', x1: 24, y1: 28, x2: 40, y2: 36 },
    { t: 'line', x1: 40, y1: 28, x2: 24, y2: 36 },
  ],
  sym_separator: [
    { t: 'rect', x: 18, y: 10, w: 28, h: 44, fill: 'none' },
    { t: 'line', x1: 18, y1: 28, x2: 46, y2: 28 },
    { t: 'path', d: 'M26 28 Q32 36 38 28', fill: 'none' },
  ],
  sym_filter: [
    { t: 'rect', x: 16, y: 18, w: 32, h: 28, fill: 'none' },
    { t: 'line', x1: 20, y1: 24, x2: 44, y2: 24 },
    { t: 'line', x1: 20, y1: 32, x2: 44, y2: 32 },
    { t: 'line', x1: 20, y1: 40, x2: 44, y2: 40 },
  ],
  sym_reactor: [
    { t: 'rect', x: 18, y: 12, w: 28, h: 40, fill: 'none' },
    { t: 'line', x1: 32, y1: 4, x2: 32, y2: 12 },
    { t: 'line', x1: 26, y1: 4, x2: 38, y2: 4 },
  ],
  sym_heat_exchanger: [
    { t: 'circle', cx: 20, cy: 32, r: 14, fill: 'none' },
    { t: 'circle', cx: 44, cy: 32, r: 14, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
  ],
  sym_cooling_tower: [
    { t: 'path', d: 'M20 54 L28 14 L36 14 L44 54 Z', fill: 'none' },
    { t: 'line', x1: 16, y1: 54, x2: 48, y2: 54 },
  ],
  sym_fired_heater: [
    { t: 'rect', x: 14, y: 20, w: 36, h: 32, fill: 'none' },
    { t: 'path', d: 'M22 52 L26 44 L30 52 M34 52 L38 44 L42 52', fill: 'none' },
  ],

  // ── Piping fittings ──
  sym_tee: [
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 32, y1: 32, x2: 32, y2: 8 },
  ],
  sym_elbow: [
    { t: 'line', x1: 6, y1: 48, x2: 32, y2: 48 },
    { t: 'line', x1: 32, y1: 48, x2: 32, y2: 16 },
    { t: 'line', x1: 32, y1: 16, x2: 48, y2: 16 },
  ],
  sym_reducer: [
    { t: 'line', x1: 6, y1: 26, x2: 28, y2: 26 },
    { t: 'line', x1: 6, y1: 38, x2: 28, y2: 38 },
    { t: 'line', x1: 28, y1: 26, x2: 58, y2: 32 },
    { t: 'line', x1: 28, y1: 38, x2: 58, y2: 32 },
  ],
  sym_flange: [
    { t: 'line', x1: 22, y1: 18, x2: 22, y2: 46 },
    { t: 'line', x1: 42, y1: 18, x2: 42, y2: 46 },
    { t: 'line', x1: 10, y1: 32, x2: 22, y2: 32 },
    { t: 'line', x1: 42, y1: 32, x2: 54, y2: 32 },
  ],
  sym_spectacle: [
    { t: 'circle', cx: 22, cy: 32, r: 12, fill: 'none' },
    { t: 'circle', cx: 42, cy: 32, r: 12, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
  ],
  sym_union: [
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
    { t: 'rect', x: 26, y: 24, w: 12, h: 16, fill: 'none' },
  ],
  sym_expansion: [
    { t: 'line', x1: 6, y1: 32, x2: 20, y2: 32 },
    { t: 'path', d: 'M20 24 Q28 32 20 40 Q36 32 44 24 Q52 32 44 40', fill: 'none' },
    { t: 'line', x1: 44, y1: 32, x2: 58, y2: 32 },
  ],
  sym_strainer: [
    { t: 'line', x1: 6, y1: 40, x2: 32, y2: 16 },
    { t: 'line', x1: 32, y1: 16, x2: 58, y2: 40 },
    { t: 'line', x1: 20, y1: 32, x2: 44, y2: 32 },
  ],
  sym_orifice_plate: [
    { t: 'line', x1: 6, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 28, y1: 20, x2: 28, y2: 44 },
    { t: 'line', x1: 36, y1: 20, x2: 36, y2: 44 },
    { t: 'circle', cx: 32, cy: 32, r: 5, fill: 'none' },
  ],
  sym_blind_flange: [
    { t: 'line', x1: 6, y1: 32, x2: 28, y2: 32 },
    { t: 'line', x1: 28, y1: 20, x2: 28, y2: 44 },
    { t: 'path', d: 'M28 20 Q40 32 28 44', fill: 'none' },
  ],
  sym_steam_trap: [
    { t: 'rect', x: 20, y: 18, w: 24, h: 28, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 20, y2: 32 },
    { t: 'line', x1: 44, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 26, y1: 24, x2: 38, y2: 36 },
    { t: 'line', x1: 38, y1: 24, x2: 26, y2: 36 },
  ],

  // ── Extended ISO 10628 / 15519 symbols ──
  sym_rupture_disc: [
    { t: 'line', x1: 6, y1: 32, x2: 24, y2: 32 },
    { t: 'line', x1: 24, y1: 20, x2: 24, y2: 44 },
    { t: 'line', x1: 40, y1: 20, x2: 40, y2: 44 },
    { t: 'line', x1: 40, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 28, y1: 24, x2: 36, y2: 40 },
    { t: 'line', x1: 36, y1: 24, x2: 28, y2: 40 },
  ],
  sym_foot_valve: [
    ...BOWTIE,
    { t: 'line', x1: 32, y1: 44, x2: 32, y2: 58 },
    { t: 'line', x1: 22, y1: 58, x2: 42, y2: 58 },
  ],
  sym_knife_gate: [
    { t: 'line', x1: 6, y1: 24, x2: 58, y2: 24 },
    { t: 'line', x1: 6, y1: 40, x2: 58, y2: 40 },
    { t: 'line', x1: 32, y1: 8, x2: 32, y2: 56 },
  ],
  sym_float_valve: [
    ...BOWTIE,
    { t: 'circle', cx: 32, cy: 8, r: 6, fill: 'none' },
    { t: 'line', x1: 32, y1: 14, x2: 32, y2: 18 },
  ],
  sym_regulating_valve: [...BOWTIE, ...DIAPHRAGM_ACTUATOR],
  sym_breather_valve: [
    ...BOWTIE,
    { t: 'path', d: 'M26 6 Q32 12 38 6', fill: 'none' },
    { t: 'line', x1: 32, y1: 12, x2: 32, y2: 18 },
  ],
  sym_rotameter: [
    { t: 'rect', x: 24, y: 10, w: 16, h: 44, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 24, y2: 32 },
    { t: 'line', x1: 40, y1: 32, x2: 58, y2: 32 },
    { t: 'poly', points: [[32, 20], [28, 36], [36, 36]], fill: 'none' },
  ],
  sym_venturi: [
    { t: 'line', x1: 6, y1: 28, x2: 22, y2: 28 },
    { t: 'line', x1: 6, y1: 36, x2: 22, y2: 36 },
    { t: 'line', x1: 22, y1: 28, x2: 32, y2: 24 },
    { t: 'line', x1: 22, y1: 36, x2: 32, y2: 40 },
    { t: 'line', x1: 32, y1: 24, x2: 42, y2: 28 },
    { t: 'line', x1: 32, y1: 40, x2: 42, y2: 36 },
    { t: 'line', x1: 42, y1: 28, x2: 58, y2: 28 },
    { t: 'line', x1: 42, y1: 36, x2: 58, y2: 36 },
  ],
  sym_sight_glass: [
    { t: 'line', x1: 6, y1: 32, x2: 22, y2: 32 },
    { t: 'circle', cx: 32, cy: 32, r: 10, fill: 'none' },
    { t: 'line', x1: 42, y1: 32, x2: 58, y2: 32 },
  ],
  sym_sample_point: [
    { t: 'line', x1: 6, y1: 32, x2: 32, y2: 32 },
    { t: 'line', x1: 32, y1: 32, x2: 32, y2: 50 },
    { t: 'circle', cx: 32, cy: 54, r: 4, fill: 'none' },
  ],
  sym_drain: [
    { t: 'line', x1: 32, y1: 8, x2: 32, y2: 40 },
    { t: 'line', x1: 6, y1: 40, x2: 58, y2: 40 },
    { t: 'poly', points: [[26, 40], [38, 40], [32, 54]], fill: 'none' },
  ],
  sym_air_vent: [
    { t: 'line', x1: 32, y1: 20, x2: 32, y2: 54 },
    { t: 'line', x1: 6, y1: 54, x2: 58, y2: 54 },
    { t: 'path', d: 'M26 14 Q32 6 38 14', fill: 'none' },
  ],
  sym_pipe_cap: [
    { t: 'line', x1: 6, y1: 32, x2: 40, y2: 32 },
    { t: 'path', d: 'M40 20 L52 32 L40 44', fill: 'none' },
  ],
  sym_spherical_tank: [
    { t: 'circle', cx: 32, cy: 32, r: 22, fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 10, y2: 32 },
    { t: 'line', x1: 54, y1: 32, x2: 58, y2: 32 },
  ],
  sym_knockout_drum: [
    { t: 'path', d: 'M14 24 L50 24 L54 32 L50 40 L14 40 L10 32 Z', fill: 'none' },
    { t: 'line', x1: 32, y1: 40, x2: 32, y2: 54 },
  ],
  sym_agitated_tank: [
    { t: 'rect', x: 18, y: 18, w: 28, h: 36, fill: 'none' },
    { t: 'line', x1: 32, y1: 6, x2: 32, y2: 18 },
    { t: 'line', x1: 24, y1: 30, x2: 40, y2: 38 },
    { t: 'line', x1: 40, y1: 30, x2: 24, y2: 38 },
  ],
  sym_packed_column: [
    { t: 'rect', x: 22, y: 8, w: 20, h: 48, fill: 'none' },
    { t: 'line', x1: 24, y1: 16, x2: 40, y2: 16 },
    { t: 'line', x1: 24, y1: 24, x2: 40, y2: 24 },
    { t: 'line', x1: 24, y1: 32, x2: 40, y2: 32 },
    { t: 'line', x1: 24, y1: 40, x2: 40, y2: 40 },
  ],
  sym_ejector: [
    { t: 'poly', points: [[8, 28], [8, 36], [36, 32]], fill: 'none' },
    { t: 'line', x1: 36, y1: 32, x2: 58, y2: 32 },
    { t: 'line', x1: 20, y1: 12, x2: 28, y2: 28 },
  ],
  sym_turbine: [
    { t: 'circle', cx: 32, cy: 32, r: 16, fill: 'none' },
    { t: 'poly', points: [[48, 32], [58, 26], [58, 38]], fill: 'none' },
    { t: 'line', x1: 6, y1: 32, x2: 16, y2: 32 },
  ],
  sym_electric_motor: [
    { t: 'circle', cx: 32, cy: 32, r: 18, fill: 'none' },
    { t: 'line', x1: 32, y1: 14, x2: 32, y2: 50 },
    { t: 'line', x1: 14, y1: 32, x2: 50, y2: 32 },
  ],
};

export function getIsoGraphics(symbolId, abbr) {
  if (ISO_SYMBOL_GRAPHICS[symbolId]) return ISO_SYMBOL_GRAPHICS[symbolId];
  if (symbolId?.startsWith('sym_')) {
    return instrumentBubble(instrumentKindForAbbr(abbr));
  }
  return [{ t: 'rect', x: 12, y: 12, w: 40, h: 40, fill: 'none' }];
}
