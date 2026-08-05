-- ============================================================
-- Migration: Extended Tag Dictionary — Additional Function Codes
-- ============================================================
-- Adds function codes commonly found in ADNOC, NOC, and offshore O&G
-- P&IDs that are missing from the base ISA S5.1 template.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO tag_dictionary (platform_id, concession_id, function_code, entity_type, discipline, description, source, confidence)
VALUES
  -- ── Instrumentation — Extended Pressure ──
  (NULL, NULL, 'PSHH',  'instrument', 'instrumentation', 'Pressure Switch High High',           'template', 1.0),
  (NULL, NULL, 'PSLL',  'instrument', 'instrumentation', 'Pressure Switch Low Low',             'template', 1.0),
  (NULL, NULL, 'PSHHL', 'instrument', 'instrumentation', 'Pressure Switch High High Lockout',   'template', 1.0),
  (NULL, NULL, 'PG',    'instrument', 'instrumentation', 'Pressure Gauge',                      'template', 1.0),
  (NULL, NULL, 'PAH',   'instrument', 'instrumentation', 'Pressure Alarm High',                 'template', 1.0),
  (NULL, NULL, 'PAL',   'instrument', 'instrumentation', 'Pressure Alarm Low',                  'template', 1.0),

  -- ── Instrumentation — Extended Level ──
  (NULL, NULL, 'LSHH',  'instrument', 'instrumentation', 'Level Switch High High',              'template', 1.0),
  (NULL, NULL, 'LSLL',  'instrument', 'instrumentation', 'Level Switch Low Low',                'template', 1.0),
  (NULL, NULL, 'LAH',   'instrument', 'instrumentation', 'Level Alarm High',                    'template', 1.0),
  (NULL, NULL, 'LAL',   'instrument', 'instrumentation', 'Level Alarm Low',                     'template', 1.0),

  -- ── Instrumentation — Extended Flow ──
  (NULL, NULL, 'FI',    'instrument', 'instrumentation', 'Flow Indicator',                      'template', 1.0),
  (NULL, NULL, 'FSH',   'instrument', 'instrumentation', 'Flow Switch High',                    'template', 1.0),
  (NULL, NULL, 'FSL',   'instrument', 'instrumentation', 'Flow Switch Low',                     'template', 1.0),

  -- ── Instrumentation — Extended Temperature ──
  (NULL, NULL, 'TSH',   'instrument', 'instrumentation', 'Temperature Switch High',             'template', 1.0),
  (NULL, NULL, 'TSL',   'instrument', 'instrumentation', 'Temperature Switch Low',              'template', 1.0),
  (NULL, NULL, 'TSHH',  'instrument', 'instrumentation', 'Temperature Switch High High',        'template', 1.0),
  (NULL, NULL, 'TG',    'instrument', 'instrumentation', 'Temperature Gauge',                   'template', 1.0),

  -- ── Instrumentation — Position / Hand ──
  (NULL, NULL, 'ZSO',   'instrument', 'instrumentation', 'Position Switch Open',                'template', 1.0),
  (NULL, NULL, 'ZSC',   'instrument', 'instrumentation', 'Position Switch Closed',              'template', 1.0),
  (NULL, NULL, 'ZLC',   'instrument', 'instrumentation', 'Position Limit Switch Closed',        'template', 1.0),
  (NULL, NULL, 'ZLO',   'instrument', 'instrumentation', 'Position Limit Switch Open',          'template', 1.0),
  (NULL, NULL, 'ZI',    'instrument', 'instrumentation', 'Position Indicator',                  'template', 1.0),
  (NULL, NULL, 'ZST',   'instrument', 'instrumentation', 'Position Switch Travel',              'template', 1.0),
  (NULL, NULL, 'XA',    'instrument', 'instrumentation', 'Unclassified Alarm',                  'template', 1.0),
  (NULL, NULL, 'XS',    'instrument', 'instrumentation', 'Unclassified Switch',                 'template', 1.0),
  (NULL, NULL, 'XL',    'instrument', 'instrumentation', 'Unclassified Light',                  'template', 1.0),

  -- ── Fire & Gas Detectors ──
  (NULL, NULL, 'DGTC',  'instrument', 'fire_gas',        'Gas Detector Toxic/Combustible',      'template', 1.0),
  (NULL, NULL, 'BGTC',  'instrument', 'fire_gas',        'Gas Detector (Beam Type)',            'template', 1.0),
  (NULL, NULL, 'FD',    'instrument', 'fire_gas',        'Fire Detector',                       'template', 1.0),

  -- ── Valves — Extended ──
  (NULL, NULL, 'HV',    'valve',      'valves',          'Hydraulic Valve',                     'template', 1.0),
  (NULL, NULL, 'ESV',   'valve',      'valves',          'Emergency Shutdown Valve',             'template', 1.0),
  (NULL, NULL, 'SSV',   'valve',      'valves',          'Surface Safety Valve',                 'template', 1.0),
  (NULL, NULL, 'WV',    'valve',      'valves',          'Wing Valve',                           'template', 1.0),
  (NULL, NULL, 'RO',    'valve',      'valves',          'Restriction Orifice',                  'template', 1.0),
  (NULL, NULL, 'DBBT',  'valve',      'valves',          'Double Block and Bleed Valve',         'template', 1.0),
  (NULL, NULL, 'XV',    'valve',      'valves',          'On/Off Valve (General)',               'template', 1.0),
  (NULL, NULL, 'NRV',   'valve',      'valves',          'Non-Return Valve',                     'template', 1.0),

  -- ── Equipment — Extended ──
  (NULL, NULL, 'GP',    'equipment',  'mechanical',      'Generator Package / Pig Launcher',    'template', 1.0),
  (NULL, NULL, 'Q',     'equipment',  'mechanical',      'Tank / Vessel (Storage)',              'template', 1.0),
  (NULL, NULL, 'AF',    'equipment',  'mechanical',      'Annular Flow Equipment / Wellhead',   'template', 1.0),
  (NULL, NULL, 'KW',    'equipment',  'instrumentation', 'Wellhead Safety Cabinet',             'template', 1.0),
  (NULL, NULL, 'FA',    'equipment',  'safety',          'Flame Arrestor',                      'template', 1.0)

ON CONFLICT DO NOTHING;
