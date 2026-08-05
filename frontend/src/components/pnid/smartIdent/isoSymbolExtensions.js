/**
 * Additional ISO 15519-2 / ISO 10628 symbols beyond the original 70-item set.
 * Letter-code instruments share PCI bubble graphics via getIsoGraphics(abbr).
 */
export const ISO_SYMBOL_EXTENSIONS = [
  // ── Pressure instruments ──
  { id: 'sym_psh', abbr: 'PSH', label: 'Pressure Switch High', category: 'instrument', keywords: ['pressure', 'switch', 'high', 'safety'] },
  { id: 'sym_psl', abbr: 'PSL', label: 'Pressure Switch Low', category: 'instrument', keywords: ['pressure', 'switch', 'low'] },
  { id: 'sym_pah', abbr: 'PAH', label: 'Pressure Alarm High', category: 'instrument', keywords: ['pressure', 'alarm', 'high'] },
  { id: 'sym_pal', abbr: 'PAL', label: 'Pressure Alarm Low', category: 'instrument', keywords: ['pressure', 'alarm', 'low'] },
  { id: 'sym_pdt', abbr: 'PDT', label: 'Differential Pressure Transmitter', category: 'instrument', keywords: ['pressure', 'differential', 'transmitter'] },
  { id: 'sym_pdi', abbr: 'PDI', label: 'Differential Pressure Indicator', category: 'instrument', keywords: ['pressure', 'differential', 'indicator'] },
  { id: 'sym_pdic', abbr: 'PDIC', label: 'Differential Pressure Controller', category: 'instrument', keywords: ['pressure', 'differential', 'controller'] },
  { id: 'sym_psv_inst', abbr: 'PSV', label: 'Pressure Safety Valve (instrument)', category: 'instrument', keywords: ['pressure', 'safety', 'relief', 'psv'] },
  { id: 'sym_pv', abbr: 'PV', label: 'Pressure Valve / Regulator', category: 'instrument', keywords: ['pressure', 'valve', 'regulator'] },

  // ── Flow instruments ──
  { id: 'sym_fsh', abbr: 'FSH', label: 'Flow Switch High', category: 'instrument', keywords: ['flow', 'switch', 'high'] },
  { id: 'sym_fsl', abbr: 'FSL', label: 'Flow Switch Low', category: 'instrument', keywords: ['flow', 'switch', 'low'] },
  { id: 'sym_fah', abbr: 'FAH', label: 'Flow Alarm High', category: 'instrument', keywords: ['flow', 'alarm', 'high'] },
  { id: 'sym_fal', abbr: 'FAL', label: 'Flow Alarm Low', category: 'instrument', keywords: ['flow', 'alarm', 'low'] },
  { id: 'sym_fq', abbr: 'FQ', label: 'Flow Totalizer', category: 'instrument', keywords: ['flow', 'totalizer', 'quantity'] },
  { id: 'sym_fv', abbr: 'FV', label: 'Flow Control Valve', category: 'instrument', keywords: ['flow', 'valve', 'control'] },

  // ── Temperature instruments ──
  { id: 'sym_te', abbr: 'TE', label: 'Temperature Element', category: 'instrument', keywords: ['temperature', 'element', 'thermowell'] },
  { id: 'sym_tsh', abbr: 'TSH', label: 'Temperature Switch High', category: 'instrument', keywords: ['temperature', 'switch', 'high'] },
  { id: 'sym_tsl', abbr: 'TSL', label: 'Temperature Switch Low', category: 'instrument', keywords: ['temperature', 'switch', 'low'] },
  { id: 'sym_tah', abbr: 'TAH', label: 'Temperature Alarm High', category: 'instrument', keywords: ['temperature', 'alarm', 'high'] },
  { id: 'sym_tal', abbr: 'TAL', label: 'Temperature Alarm Low', category: 'instrument', keywords: ['temperature', 'alarm', 'low'] },
  { id: 'sym_tw', abbr: 'TW', label: 'Thermowell', category: 'instrument', keywords: ['temperature', 'well', 'thermowell'] },

  // ── Level instruments ──
  { id: 'sym_le', abbr: 'LE', label: 'Level Element', category: 'instrument', keywords: ['level', 'element'] },
  { id: 'sym_lsh', abbr: 'LSH', label: 'Level Switch High', category: 'instrument', keywords: ['level', 'switch', 'high'] },
  { id: 'sym_lsl', abbr: 'LSL', label: 'Level Switch Low', category: 'instrument', keywords: ['level', 'switch', 'low'] },
  { id: 'sym_lah', abbr: 'LAH', label: 'Level Alarm High', category: 'instrument', keywords: ['level', 'alarm', 'high'] },
  { id: 'sym_lal', abbr: 'LAL', label: 'Level Alarm Low', category: 'instrument', keywords: ['level', 'alarm', 'low'] },

  // ── Analyzer & misc instruments ──
  { id: 'sym_ae', abbr: 'AE', label: 'Analyzer Element', category: 'instrument', keywords: ['analyzer', 'element'] },
  { id: 'sym_ai', abbr: 'AI', label: 'Analyzer Indicator', category: 'instrument', keywords: ['analyzer', 'indicator'] },
  { id: 'sym_aic', abbr: 'AIC', label: 'Analyzer Controller', category: 'instrument', keywords: ['analyzer', 'controller'] },
  { id: 'sym_arc', abbr: 'ARC', label: 'Analyzer Recorder', category: 'instrument', keywords: ['analyzer', 'recorder'] },
  { id: 'sym_dt', abbr: 'DT', label: 'Density Transmitter', category: 'instrument', keywords: ['density', 'transmitter'] },
  { id: 'sym_di', abbr: 'DI', label: 'Density Indicator', category: 'instrument', keywords: ['density', 'indicator'] },
  { id: 'sym_wt', abbr: 'WT', label: 'Weight Transmitter', category: 'instrument', keywords: ['weight', 'transmitter'] },
  { id: 'sym_hs', abbr: 'HS', label: 'Hand Switch', category: 'instrument', keywords: ['hand', 'switch', 'manual'] },
  { id: 'sym_hv', abbr: 'HV', label: 'Hand Valve', category: 'instrument', keywords: ['hand', 'valve', 'manual'] },
  { id: 'sym_esd', abbr: 'ESD', label: 'Emergency Shutdown', category: 'instrument', keywords: ['emergency', 'shutdown', 'safety', 'sis'] },

  // ── Valve position / on-off ──
  { id: 'sym_zsc', abbr: 'ZSC', label: 'Valve Position Switch Closed', category: 'instrument', keywords: ['valve', 'position', 'closed', 'switch'] },
  { id: 'sym_zso', abbr: 'ZSO', label: 'Valve Position Switch Open', category: 'instrument', keywords: ['valve', 'position', 'open', 'switch'] },
  { id: 'sym_zsh', abbr: 'ZSH', label: 'Valve Position Switch High', category: 'instrument', keywords: ['valve', 'position', 'high'] },
  { id: 'sym_zsl', abbr: 'ZSL', label: 'Valve Position Switch Low', category: 'instrument', keywords: ['valve', 'position', 'low'] },
  { id: 'sym_zt', abbr: 'ZT', label: 'Valve Position Transmitter', category: 'instrument', keywords: ['valve', 'position', 'transmitter'] },
  { id: 'sym_xv', abbr: 'XV', label: 'On/Off Valve', category: 'instrument', keywords: ['valve', 'on', 'off', 'shutdown'] },
  { id: 'sym_xy', abbr: 'XY', label: 'Valve Solenoid / Actuator', category: 'instrument', keywords: ['valve', 'solenoid', 'actuator'] },

  // ── Additional valves ──
  { id: 'sym_rupture_disc', abbr: 'RD', label: 'Rupture Disc', category: 'valve', keywords: ['rupture', 'disc', 'burst', 'safety'] },
  { id: 'sym_foot_valve', abbr: 'FV', label: 'Foot Valve', category: 'valve', keywords: ['foot', 'check', 'pump'] },
  { id: 'sym_knife_gate', abbr: 'KGV', label: 'Knife Gate Valve', category: 'valve', keywords: ['knife', 'gate', 'slide'] },
  { id: 'sym_float_valve', abbr: 'FLV', label: 'Float Valve', category: 'valve', keywords: ['float', 'level'] },
  { id: 'sym_regulating_valve', abbr: 'RV', label: 'Regulating Valve', category: 'valve', keywords: ['regulating', 'self', 'acting'] },
  { id: 'sym_breather_valve', abbr: 'BV', label: 'Breather Valve', category: 'valve', keywords: ['breather', 'tank', 'vent'] },

  // ── Additional pumps / rotating ──
  { id: 'sym_turbine', abbr: 'TUR', label: 'Turbine', category: 'pump', keywords: ['turbine', 'expand', 'driver'] },
  { id: 'sym_ejector', abbr: 'EJ', label: 'Ejector / Eductor', category: 'pump', keywords: ['ejector', 'eductor', 'vacuum'] },
  { id: 'sym_electric_motor', abbr: 'M', label: 'Electric Motor', category: 'pump', keywords: ['motor', 'electric', 'driver'] },

  // ── Additional equipment ──
  { id: 'sym_spherical_tank', abbr: 'SPT', label: 'Spherical Tank', category: 'equipment', keywords: ['sphere', 'tank', 'storage'] },
  { id: 'sym_knockout_drum', abbr: 'KD', label: 'Knockout Drum', category: 'equipment', keywords: ['knockout', 'drum', 'separator'] },
  { id: 'sym_agitated_tank', abbr: 'ATK', label: 'Agitated Tank', category: 'equipment', keywords: ['agitated', 'mixer', 'tank'] },
  { id: 'sym_packed_column', abbr: 'PCOL', label: 'Packed Column', category: 'equipment', keywords: ['packed', 'column', 'tower'] },

  // ── Additional piping / inline ──
  { id: 'sym_rotameter', abbr: 'ROTA', label: 'Rotameter', category: 'piping', keywords: ['rotameter', 'flow', 'variable', 'area'] },
  { id: 'sym_venturi', abbr: 'VENT', label: 'Venturi Tube', category: 'piping', keywords: ['venturi', 'flow', 'meter'] },
  { id: 'sym_sight_glass', abbr: 'SG', label: 'Sight Glass', category: 'piping', keywords: ['sight', 'glass', 'level'] },
  { id: 'sym_sample_point', abbr: 'SP', label: 'Sample Point', category: 'piping', keywords: ['sample', 'point', 'tap'] },
  { id: 'sym_drain', abbr: 'DR', label: 'Drain', category: 'piping', keywords: ['drain', 'blowdown'] },
  { id: 'sym_air_vent', abbr: 'AV', label: 'Air Vent', category: 'piping', keywords: ['air', 'vent', 'vacuum'] },
  { id: 'sym_pipe_cap', abbr: 'CAP', label: 'Pipe Cap / End', category: 'piping', keywords: ['cap', 'end', 'blind'] },
];

export const ISO_EXTENSION_COUNT = ISO_SYMBOL_EXTENSIONS.length;
