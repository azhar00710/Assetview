-- ============================================================
-- Migration: Tag Dictionary — Client-Specific Tag Classification
-- ============================================================
-- Stores per-platform/concession function-code → entity-type mappings
-- so the OCR TagClassifier respects client tagging standards
-- (e.g., NOC SD-NOC-EC-106, ADNOC, Saudi Aramco conventions).
-- ============================================================

-- ── tag_dictionary ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tag_dictionary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: platform-specific, concession-wide, or global (both NULL)
  platform_id     UUID REFERENCES platform(id) ON DELETE CASCADE,
  concession_id   UUID REFERENCES concession(id) ON DELETE CASCADE,

  -- The function code / prefix (e.g., "PT", "BDV", "ESDV", "V", "FCV")
  function_code   VARCHAR(10) NOT NULL,

  -- Classification target
  entity_type     VARCHAR(30) NOT NULL
    CHECK (entity_type IN (
      'equipment', 'instrument', 'valve', 'line',
      'cable', 'signal', 'structural', 'safety',
      'hvac', 'telecom', 'fire_gas', 'piping', 'unknown'
    )),

  -- Discipline grouping for UI display
  discipline      VARCHAR(30)
    CHECK (discipline IS NULL OR discipline IN (
      'mechanical', 'electrical', 'instrumentation', 'telecom',
      'fire_gas', 'safety', 'valves', 'hvac', 'piping', 'structural'
    )),

  -- Human-readable description (e.g., "Pressure Transmitter")
  description     VARCHAR(200),

  -- Optional: full tag regex pattern for complex client formats
  -- e.g., "^[A-Z]{5}-PT-\d{6}[A-Z]?$" for NOC-style LOCATION-FUNCTION-NUMBER
  tag_pattern     VARCHAR(200),

  -- Optional: number code format hint for display/validation
  -- e.g., "2-digit system + 4-digit sequence" or "2-digit system + 2-digit sequence"
  number_format   VARCHAR(100),

  -- How this entry was created
  source          VARCHAR(30) DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv_upload', 'ai_detected', 'template')),

  -- Confidence (primarily for ai_detected entries)
  confidence      DECIMAL(4,3) DEFAULT 1.000,

  -- User can deactivate without deleting
  is_active       BOOLEAN DEFAULT true,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      VARCHAR(100),

  -- Prevent duplicate function codes within the same scope
  UNIQUE NULLS NOT DISTINCT (platform_id, concession_id, function_code)
);

-- Indexes for fast lookup during OCR classification
CREATE INDEX IF NOT EXISTS idx_tag_dict_platform
  ON tag_dictionary(platform_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tag_dict_concession
  ON tag_dictionary(concession_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tag_dict_code
  ON tag_dictionary(function_code);
CREATE INDEX IF NOT EXISTS idx_tag_dict_entity_type
  ON tag_dictionary(entity_type) WHERE is_active = true;


-- ── tag_dictionary_upload ───────────────────────────────────
-- Audit trail for CSV/Excel imports
CREATE TABLE IF NOT EXISTS tag_dictionary_upload (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     UUID REFERENCES platform(id) ON DELETE CASCADE,
  concession_id   UUID REFERENCES concession(id) ON DELETE CASCADE,
  filename        VARCHAR(255),
  storage_key     VARCHAR(500),
  total_entries   INTEGER DEFAULT 0,
  added_entries   INTEGER DEFAULT 0,
  updated_entries INTEGER DEFAULT 0,
  skipped_entries INTEGER DEFAULT 0,
  errors          JSONB DEFAULT '[]'::jsonb,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by     VARCHAR(100)
);


-- ── Seed: ISA S5.1 base template entries (global scope) ────
-- These serve as the default fallback when no platform-specific dictionary exists.
-- Source: ISA-5.1-2009 Instrumentation Symbols and Identification + common O&G equipment codes.

INSERT INTO tag_dictionary (platform_id, concession_id, function_code, entity_type, discipline, description, source, confidence)
VALUES
  -- ── Mechanical / Equipment ──
  (NULL, NULL, 'V',    'equipment',  'mechanical',      'Vessel',                       'template', 1.0),
  (NULL, NULL, 'P',    'equipment',  'mechanical',      'Pump',                         'template', 1.0),
  (NULL, NULL, 'E',    'equipment',  'mechanical',      'Heat Exchanger',               'template', 1.0),
  (NULL, NULL, 'C',    'equipment',  'mechanical',      'Compressor',                   'template', 1.0),
  (NULL, NULL, 'T',    'equipment',  'mechanical',      'Tank',                         'template', 1.0),
  (NULL, NULL, 'F',    'equipment',  'mechanical',      'Fired Heater / Furnace',       'template', 1.0),
  (NULL, NULL, 'R',    'equipment',  'mechanical',      'Reactor',                      'template', 1.0),
  (NULL, NULL, 'D',    'equipment',  'mechanical',      'Drum / Diesel Engine',         'template', 1.0),
  (NULL, NULL, 'B',    'equipment',  'mechanical',      'Blower',                       'template', 1.0),
  (NULL, NULL, 'G',    'equipment',  'mechanical',      'Generator',                    'template', 1.0),
  (NULL, NULL, 'K',    'equipment',  'mechanical',      'Compressor (alt.)',            'template', 1.0),
  (NULL, NULL, 'M',    'equipment',  'mechanical',      'Mixer / Skimmer',              'template', 1.0),
  (NULL, NULL, 'S',    'equipment',  'mechanical',      'Strainer / Separator',         'template', 1.0),
  (NULL, NULL, 'TK',   'equipment',  'mechanical',      'Tank (alt.)',                  'template', 1.0),
  (NULL, NULL, 'SEP',  'equipment',  'mechanical',      'Separator',                    'template', 1.0),
  (NULL, NULL, 'FIL',  'equipment',  'mechanical',      'Filter',                       'template', 1.0),
  (NULL, NULL, 'GT',   'equipment',  'mechanical',      'Gas Turbine Generator',        'template', 1.0),
  (NULL, NULL, 'CT',   'equipment',  'mechanical',      'Compressor Gas Turbine',       'template', 1.0),
  (NULL, NULL, 'EP',   'equipment',  'mechanical',      'Pig Launcher/Receiver',        'template', 1.0),
  (NULL, NULL, 'A',    'equipment',  'mechanical',      'Package Equipment',            'template', 1.0),

  -- ── Instrumentation — Pressure ──
  (NULL, NULL, 'PT',   'instrument', 'instrumentation', 'Pressure Transmitter',         'template', 1.0),
  (NULL, NULL, 'PI',   'instrument', 'instrumentation', 'Pressure Indicator',           'template', 1.0),
  (NULL, NULL, 'PIT',  'instrument', 'instrumentation', 'Pressure Indicating Transmitter', 'template', 1.0),
  (NULL, NULL, 'PC',   'instrument', 'instrumentation', 'Pressure Controller',          'template', 1.0),
  (NULL, NULL, 'PS',   'instrument', 'instrumentation', 'Pressure Switch',              'template', 1.0),
  (NULL, NULL, 'PSH',  'instrument', 'instrumentation', 'Pressure Switch High',         'template', 1.0),
  (NULL, NULL, 'PSL',  'instrument', 'instrumentation', 'Pressure Switch Low',          'template', 1.0),
  (NULL, NULL, 'PDT',  'instrument', 'instrumentation', 'Pressure Differential Transmitter', 'template', 1.0),
  (NULL, NULL, 'PDI',  'instrument', 'instrumentation', 'Pressure Differential Indicator', 'template', 1.0),

  -- ── Instrumentation — Temperature ──
  (NULL, NULL, 'TT',   'instrument', 'instrumentation', 'Temperature Transmitter',      'template', 1.0),
  (NULL, NULL, 'TI',   'instrument', 'instrumentation', 'Temperature Indicator',        'template', 1.0),
  (NULL, NULL, 'TIT',  'instrument', 'instrumentation', 'Temperature Indicating Transmitter', 'template', 1.0),
  (NULL, NULL, 'TC',   'instrument', 'instrumentation', 'Temperature Controller',       'template', 1.0),
  (NULL, NULL, 'TE',   'instrument', 'instrumentation', 'Temperature Element',          'template', 1.0),
  (NULL, NULL, 'TS',   'instrument', 'instrumentation', 'Temperature Switch',           'template', 1.0),
  (NULL, NULL, 'TW',   'instrument', 'instrumentation', 'Thermowell',                   'template', 1.0),
  (NULL, NULL, 'RTD',  'instrument', 'instrumentation', 'Resistance Temperature Detector', 'template', 1.0),

  -- ── Instrumentation — Flow ──
  (NULL, NULL, 'FT',   'instrument', 'instrumentation', 'Flow Transmitter / Meter',     'template', 1.0),
  (NULL, NULL, 'FI',   'instrument', 'instrumentation', 'Flow Indicator',               'template', 1.0),
  (NULL, NULL, 'FIT',  'instrument', 'instrumentation', 'Flow Indicating Transmitter',  'template', 1.0),
  (NULL, NULL, 'FC',   'instrument', 'instrumentation', 'Flow Controller',              'template', 1.0),
  (NULL, NULL, 'FE',   'instrument', 'instrumentation', 'Flow Element',                 'template', 1.0),
  (NULL, NULL, 'FO',   'instrument', 'instrumentation', 'Flow Orifice',                 'template', 1.0),
  (NULL, NULL, 'FS',   'instrument', 'instrumentation', 'Flow Switch',                  'template', 1.0),
  (NULL, NULL, 'FQ',   'instrument', 'instrumentation', 'Flow Totalizer',               'template', 1.0),

  -- ── Instrumentation — Level ──
  (NULL, NULL, 'LT',   'instrument', 'instrumentation', 'Level Transmitter',            'template', 1.0),
  (NULL, NULL, 'LI',   'instrument', 'instrumentation', 'Level Indicator',              'template', 1.0),
  (NULL, NULL, 'LIT',  'instrument', 'instrumentation', 'Level Indicating Transmitter', 'template', 1.0),
  (NULL, NULL, 'LC',   'instrument', 'instrumentation', 'Level Controller',             'template', 1.0),
  (NULL, NULL, 'LG',   'instrument', 'instrumentation', 'Level Gauge Glass',            'template', 1.0),
  (NULL, NULL, 'LS',   'instrument', 'instrumentation', 'Level Switch',                 'template', 1.0),
  (NULL, NULL, 'LSH',  'instrument', 'instrumentation', 'Level Switch High',            'template', 1.0),
  (NULL, NULL, 'LSL',  'instrument', 'instrumentation', 'Level Switch Low',             'template', 1.0),

  -- ── Instrumentation — Analyzer ──
  (NULL, NULL, 'AT',   'instrument', 'instrumentation', 'Analyzer Transmitter',         'template', 1.0),
  (NULL, NULL, 'AI',   'instrument', 'instrumentation', 'Analyzer Indicator',           'template', 1.0),
  (NULL, NULL, 'AIT',  'instrument', 'instrumentation', 'Analyzer Indicating Transmitter', 'template', 1.0),

  -- ── Instrumentation — Miscellaneous ──
  (NULL, NULL, 'VT',   'instrument', 'instrumentation', 'Vibration Transmitter',        'template', 1.0),
  (NULL, NULL, 'ST',   'instrument', 'instrumentation', 'Speed Transmitter',            'template', 1.0),
  (NULL, NULL, 'ZS',   'instrument', 'instrumentation', 'Position Switch',              'template', 1.0),
  (NULL, NULL, 'ZT',   'instrument', 'instrumentation', 'Position Transmitter',         'template', 1.0),
  (NULL, NULL, 'HS',   'instrument', 'instrumentation', 'Manual Selector Switch',       'template', 1.0),
  (NULL, NULL, 'HT',   'instrument', 'instrumentation', 'Humidity Transmitter',         'template', 1.0),
  (NULL, NULL, 'DT',   'instrument', 'instrumentation', 'Density Transmitter',          'template', 1.0),
  (NULL, NULL, 'IPC',  'instrument', 'instrumentation', 'I/P Converter',                'template', 1.0),

  -- ── Valves ──
  (NULL, NULL, 'BDV',  'valve',      'valves',          'Blowdown Valve',               'template', 1.0),
  (NULL, NULL, 'ESDV', 'valve',      'valves',          'Emergency Shutdown Valve',      'template', 1.0),
  (NULL, NULL, 'SDV',  'valve',      'valves',          'Shutdown Valve',                'template', 1.0),
  (NULL, NULL, 'PSV',  'valve',      'valves',          'Pressure Safety Valve',         'template', 1.0),
  (NULL, NULL, 'PRV',  'valve',      'valves',          'Pressure Relief Valve',         'template', 1.0),
  (NULL, NULL, 'FCV',  'valve',      'valves',          'Flow Control Valve',            'template', 1.0),
  (NULL, NULL, 'PCV',  'valve',      'valves',          'Pressure Control Valve',        'template', 1.0),
  (NULL, NULL, 'LCV',  'valve',      'valves',          'Level Control Valve',           'template', 1.0),
  (NULL, NULL, 'TCV',  'valve',      'valves',          'Temperature Control Valve',     'template', 1.0),
  (NULL, NULL, 'MOV',  'valve',      'valves',          'Motor Operated Valve',          'template', 1.0),
  (NULL, NULL, 'SOV',  'valve',      'valves',          'Solenoid Operated Valve',       'template', 1.0),
  (NULL, NULL, 'CHV',  'valve',      'valves',          'Check Valve',                   'template', 1.0),
  (NULL, NULL, 'HCV',  'valve',      'valves',          'Hand Control Valve',            'template', 1.0),
  (NULL, NULL, 'XCV',  'valve',      'valves',          'Operated Valve',                'template', 1.0),
  (NULL, NULL, 'CVA',  'valve',      'valves',          'Choke Valve (Adjustable)',      'template', 1.0),
  (NULL, NULL, 'PDCV', 'valve',      'valves',          'Pressure Differential Control Valve', 'template', 1.0),

  -- ── Fire & Gas ──
  (NULL, NULL, 'GD',   'instrument', 'fire_gas',        'Gas Detector',                  'template', 1.0),
  (NULL, NULL, 'GDT',  'instrument', 'fire_gas',        'Gas Detector Transmitter',      'template', 1.0),
  (NULL, NULL, 'HD',   'instrument', 'fire_gas',        'H2S Detector',                  'template', 1.0),
  (NULL, NULL, 'SD',   'instrument', 'fire_gas',        'Smoke Detector',                'template', 1.0),
  (NULL, NULL, 'IR',   'instrument', 'fire_gas',        'IR Flame Detector',             'template', 1.0),
  (NULL, NULL, 'UV',   'instrument', 'fire_gas',        'UV Flame Detector',             'template', 1.0),
  (NULL, NULL, 'HDC',  'instrument', 'fire_gas',        'Heat Detector (Compensated)',   'template', 1.0),
  (NULL, NULL, 'HR',   'instrument', 'fire_gas',        'Heat Detector (Rate of Rise)',  'template', 1.0),

  -- ── Electrical ──
  (NULL, NULL, 'PM',   'equipment',  'electrical',      'Pump Electric Motor',           'template', 1.0),
  (NULL, NULL, 'CM',   'equipment',  'electrical',      'Compressor Motor',              'template', 1.0),
  (NULL, NULL, 'N',    'equipment',  'electrical',      'Switchboard / MCC',             'template', 1.0),
  (NULL, NULL, 'AE',   'equipment',  'electrical',      'Battery and UPS System',        'template', 1.0),
  (NULL, NULL, 'TN',   'equipment',  'electrical',      'Transformer',                   'template', 1.0),
  (NULL, NULL, 'VSD',  'equipment',  'electrical',      'Variable Speed Drive',          'template', 1.0),
  (NULL, NULL, 'CP',   'equipment',  'electrical',      'Control Panel',                 'template', 1.0),
  (NULL, NULL, 'DP',   'equipment',  'electrical',      'Distribution Panel',            'template', 1.0)

ON CONFLICT DO NOTHING;
