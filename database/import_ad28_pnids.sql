-- Import missing AD-28 P&IDs and link to systems per data/PNID_List_import.csv
-- Also adds AD-28-D-100000-SHT-001 (drawing index) from local PDF storage

BEGIN;

-- Ensure all P&IDs have correct storage keys and has_image flag
UPDATE pnid SET
  storage_key = 'pids/' || drawing_number || '.pdf',
  has_image = true,
  uploaded_at = COALESCE(uploaded_at, NOW())
WHERE drawing_number LIKE 'AD-28-D-10000%-SHT-001' AND deleted_at IS NULL;

-- AD-28-D-100000-SHT-001 — Drawing Index (not in CSV, but PDF exists locally)
INSERT INTO pnid (id, drawing_number, title, revision, status, sheet_number, total_sheets, storage_key, has_image, uploaded_at)
VALUES (
  'd0000000-0000-0000-0000-000000000000'::uuid,
  'AD-28-D-100000-SHT-001',
  'Drawing Index P&ID',
  '1', 'approved', 1, 1,
  'pids/AD-28-D-100000-SHT-001.pdf', true, NOW()
)
ON CONFLICT (drawing_number) DO UPDATE SET
  title = EXCLUDED.title,
  storage_key = EXCLUDED.storage_key,
  has_image = true,
  deleted_at = NULL,
  updated_at = NOW();

-- AD-28-D-100002 through 100007
INSERT INTO pnid (id, drawing_number, title, revision, status, sheet_number, total_sheets, storage_key, has_image, uploaded_at) VALUES
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'AD-28-D-100002-SHT-001', 'Corrosion Inhibitor Package G-2802 P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100002-SHT-001.pdf', true, NOW()),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'AD-28-D-100003-SHT-001', 'Deck Drain & Dry Service Water System P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100003-SHT-001.pdf', true, NOW()),
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'AD-28-D-100004-SHT-001', 'Methanol Injection Package G-2801 P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100004-SHT-001.pdf', true, NOW()),
  ('d0000000-0000-0000-0000-000000000005'::uuid, 'AD-28-D-100005-SHT-001', 'AF-9 AKK4 Wellhead Flow Lines P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100005-SHT-001.pdf', true, NOW()),
  ('d0000000-0000-0000-0000-000000000006'::uuid, 'AD-28-D-100006-SHT-001', 'AF-10 AKK4 Wellhead Flow Lines P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100006-SHT-001.pdf', true, NOW()),
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'AD-28-D-100007-SHT-001', 'Pig Launcher & Manifold P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100007-SHT-001.pdf', true, NOW())
ON CONFLICT (drawing_number) DO UPDATE SET
  title = EXCLUDED.title,
  storage_key = EXCLUDED.storage_key,
  has_image = true,
  deleted_at = NULL,
  updated_at = NOW();

-- System links helper: insert primary + secondary without duplicating
-- 100000: index sheet → primary Production (12)
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000000'::uuid, 'a3000012-0000-0000-0000-000000000001'::uuid, true)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100002: primary 22, secondary 29,31,99
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'a3000029-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'a3000031-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'a3000099-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100003: primary 12, secondary 22,27,31,99
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'a3000012-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'a3000027-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'a3000031-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'a3000099-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100004: primary 21, secondary 22,29,31,99
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'a3000021-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'a3000029-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'a3000031-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000004'::uuid, 'a3000099-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100005: primary 12, secondary 22,29
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000005'::uuid, 'a3000012-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000005'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000005'::uuid, 'a3000029-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100006: primary 12, secondary 22,29
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000006'::uuid, 'a3000012-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000006'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000006'::uuid, 'a3000029-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- 100007: primary 12, secondary 22,29,31,99
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'a3000012-0000-0000-0000-000000000001'::uuid, true),
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'a3000022-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'a3000029-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'a3000031-0000-0000-0000-000000000001'::uuid, false),
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'a3000099-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (pnid_id, system_id) DO NOTHING;

-- Fix has_image on existing 100001
UPDATE pnid SET has_image = true WHERE drawing_number = 'AD-28-D-100001-SHT-001';

COMMIT;
