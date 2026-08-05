-- ═══════════════════════════════════════════════════════════════════
-- SEED TEST DATA — 1 P&ID end-to-end test
-- P&ID: AD-28-D-100001-SHT-001 (Production Lines)
-- ═══════════════════════════════════════════════════════════════════

-- Hierarchy: Client → Project → Concession → Location → Complex → Platform
INSERT INTO client (id, name, code) VALUES
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'ADNOC Offshore', 'ADNOC')
ON CONFLICT DO NOTHING;

INSERT INTO project (id, client_id, name, code) VALUES
  ('p0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'AS-BUILT Recovery Phase II', 'ABR2')
ON CONFLICT DO NOTHING;

INSERT INTO concession (id, name, code) VALUES
  ('cn000000-0000-0000-0000-000000000001'::uuid, 'Abu Dhabi Block 219', 'AD219')
ON CONFLICT DO NOTHING;

INSERT INTO location (id, concession_id, name, code) VALUES
  ('lo000000-0000-0000-0000-000000000001'::uuid, 'cn000000-0000-0000-0000-000000000001'::uuid, 'Abu Al Bukhoosh', 'ABK')
ON CONFLICT DO NOTHING;

INSERT INTO complex (id, location_id, name, code) VALUES
  ('cx000000-0000-0000-0000-000000000001'::uuid, 'lo000000-0000-0000-0000-000000000001'::uuid, 'ABK Complex', 'ABK')
ON CONFLICT DO NOTHING;

INSERT INTO platform (id, complex_id, name, code, status) VALUES
  ('pl000000-0000-0000-0000-000000000001'::uuid, 'cx000000-0000-0000-0000-000000000001'::uuid, 'AKK4 Well Head Platform', 'AD28', 'operating')
ON CONFLICT DO NOTHING;

-- Systems
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000012-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '12', 'Production', 'process')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000018-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '18', 'Test / Metering', 'process')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000021-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '21', 'Nitrogen', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000022-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '22', 'Vent', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000027-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '27', 'Fire Water', 'safety')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000029-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '29', 'Chemical Injection', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000031-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '31', 'Closed Drain', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('sy000099-0000-0000-0000-000000000001'::uuid, 'pl000000-0000-0000-0000-000000000001'::uuid, '99', 'Vessel Trim', 'process')
ON CONFLICT DO NOTHING;

-- P&ID: AD-28-D-100001-SHT-001
INSERT INTO pnid (id, drawing_number, title, revision, status, sheet_number, total_sheets, storage_key) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'AD-28-D-100001-SHT-001', 'Production Lines P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100001-SHT-001.pdf')
ON CONFLICT DO NOTHING;

-- P&ID ↔ System junctions
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, true)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000018-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000021-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'sy000099-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;

-- Equipment
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000001-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'P-2802.C', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000002-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'AF-09', 'Wellhead', 'Annular Flow Equipment', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000003-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'LT-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000004-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-06', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000005-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-04', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000006-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-05', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000007-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-02', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000008-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-09', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000009-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-06', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000010-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'SSV-289920.C', 'Equipment', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000011-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PT-289901.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000012-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-05', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000013-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PT-289901.A/B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000014-0000-0000-0000-000000000001'::uuid, 'sy000099-0000-0000-0000-000000000001'::uuid, 'CRANE', 'Crane', 'Platform Crane', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000015-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-06', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000016-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-07', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000017-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-04', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000018-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-02', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000019-0000-0000-0000-000000000001'::uuid, 'sy000099-0000-0000-0000-000000000001'::uuid, 'Q-2801', 'Heat Exchanger', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000020-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-01', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000021-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'GP-2802', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000022-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-07', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000023-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-01', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000024-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-08', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000025-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-07', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000026-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, 'Q-2803', 'Heat Exchanger', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000027-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.B-03', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000028-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, 'LT-283010', 'Equipment', 'Part of Q-2803', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000029-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Q-2802', 'Heat Exchanger', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000030-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-05', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000031-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, 'GP-2801', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000032-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'SSV-289920.A', 'Equipment', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000033-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'P-2802.B', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000034-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'SSV-289920.B', 'Equipment', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000035-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-03', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000036-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'AF-10', 'Wellhead', 'Annular Flow Equipment', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000037-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-02', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000038-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'P-2802.A', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000039-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'WV-289930.C', 'Wing Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000040-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-08', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000041-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-01', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000042-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'WV-289930.A', 'Wing Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000043-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'G-2802', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000044-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-09', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000045-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'WV-289930.B', 'Wing Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000046-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.A-03', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000047-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HV-289920.C-04', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000048-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Needle Valve-0112', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000049-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3971', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000050-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10878', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000051-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Needle Valve-0111', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000052-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'V-28196', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000053-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10884', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000054-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3968', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000055-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10879', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000056-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'V-28200', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000057-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'DBBT-1182', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000058-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Gate Valve-2322', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000059-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Gate Valve-2325', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000060-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'DBBT-1181', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000061-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3974', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000062-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3969', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000063-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'V-28195', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000064-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3970', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000065-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10874', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000066-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10875', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000067-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Check Valve-3748', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000068-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10876', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000069-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'DBBT-1180', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000070-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10880', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000071-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10882', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000072-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'V-28198', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000073-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3972', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000074-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Check Valve-3750', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000075-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'DBBT-1183', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000076-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10877', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000077-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Gate Valve-2324', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000078-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3973', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000079-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10885', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000080-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Check Valve-3749', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000081-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'V-28197', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000082-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10883', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000083-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Gate Valve-2326', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000084-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Ball Valve-10881', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000085-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Globe Valve-3975', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000086-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Gate Valve-2323', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000087-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PG-282010.B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000088-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PG-282010.A', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000089-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'LT-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000090-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PT-289901.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000091-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'LG-282020', 'Level Gauge', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000092-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'LSLL-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000093-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PSV-282020.C', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000094-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PT-289901.B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000095-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8738', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000096-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8735', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000097-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PT-289901.A', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000098-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8736', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000099-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PSV-282020.B', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000100-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PG-282010.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000101-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'PSV-282020.A', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000102-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8733', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000103-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8734', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('eq000104-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, 'Component-8737', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;

-- Instruments
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000001-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.04', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000002-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281031', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000003-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289941.B', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000004-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281014.C', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000005-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281045.A', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000006-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HCV-281040.A', 'Hydraulic Control Valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000007-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289951', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000008-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289943.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000009-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.02', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000010-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.A', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000011-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281010.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000012-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FT-281010.C', 'Flow Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000013-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281015.B', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000014-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289945.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000015-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289962', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000016-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281010.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000017-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.05', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000018-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281014.A', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000019-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289941.C', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000020-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281020.A', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000021-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281013.B', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000022-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281040.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000023-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.07', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000024-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289944.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000025-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281013.C', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000026-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HCV-281040.C', 'Hydraulic Control Valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000027-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281014.B', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000028-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289942.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000029-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289945.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000030-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281010.A', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000031-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289941.A', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000032-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289940.C', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000033-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000034-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289961', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000035-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FI-281010.C2', 'Flow Indicator', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000036-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289944.A', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000037-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.B/281040.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000038-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281015.C', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000039-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FT-281010.A', 'Flow Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000040-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281020.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000041-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FI-281010.A2', 'Flow Indicator', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000042-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.C/281040.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000043-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281040.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000044-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'HCV-281040.B', 'Hydraulic Control Valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000045-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281016.C', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000046-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289340.A', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000047-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281013.A', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000048-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.06', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000049-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.08', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000050-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.03', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000051-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'DGTC-287700.01', 'Gas Detector', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000052-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281020.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000053-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSLL-289940.B', 'Pressure Switch Low Low', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000054-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281010.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000055-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281015.A', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000056-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281012.A', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000057-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'TT-281010.A', 'Temperature Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000058-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281030', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000059-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FI-281010.B2', 'Flow Indicator', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000060-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.A/PT-281045.A', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000061-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'FT-281010.B', 'Flow Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000062-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281044.C', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000063-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PT-281010.B', 'Pressure Transmitter', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000064-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PG-281017.A', 'Pressure Gauge', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('in000065-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, 'PSHH-289950', 'Pressure Switch High High', NULL)
ON CONFLICT DO NOTHING;

-- Lines (referenced on AD-28-D-100001-SHT-001)
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000001-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '1-DH-28-31-0414-B06S-N', 'Closed Drain', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000001-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000002-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-H-28-12-0105-J16-P', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000002-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000003-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-H-28-12-0113-H03S-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000003-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000004-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-H-28-12-0114-H03S-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000004-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000005-0000-0000-0000-000000000001'::uuid, 'sy000018-0000-0000-0000-000000000001'::uuid, '1-H-28-18-0101-J16-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000005-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000006-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-JC-28-29-0201-J16-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000006-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000007-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-JC-28-29-0201-J47-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000007-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000008-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-JC-28-29-0201-J48-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000008-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000009-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-MT-28-29-0201-J16-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000009-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000010-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-MT-28-29-0201-J47-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000010-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000011-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-MT-28-29-0202-J47-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000011-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000012-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-1/2-H-28-12-0105-J16-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000012-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000013-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-1/2-H-28-12-0107-J16-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000013-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000014-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '1-1/2-H-28-12-0113-H03S-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000014-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000015-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-1/2-MT-28-29-0110-J48-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000015-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000016-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-1/2-MT-28-29-0201-J47-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000016-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000017-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '1-1/2-MT-28-29-0202-J47-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000017-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000018-0000-0000-0000-000000000001'::uuid, 'sy000021-0000-0000-0000-000000000001'::uuid, '1-1/2-N-28-21-0201-J47-N', 'Nitrogen', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000018-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000019-0000-0000-0000-000000000001'::uuid, 'sy000021-0000-0000-0000-000000000001'::uuid, '1-1/2-N-28-21-0201-J48-N', 'Nitrogen', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000019-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000020-0000-0000-0000-000000000001'::uuid, 'sy000021-0000-0000-0000-000000000001'::uuid, '1/2-N-28-21-0201-J47-N', 'Nitrogen', '1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000020-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000021-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0101-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000021-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000022-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0103-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000022-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000023-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0104-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000023-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000024-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0105-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000024-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000025-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0108-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000025-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000026-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0109-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000026-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000027-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '2-DH-28-31-0414-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000027-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000028-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0102-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000028-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000029-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0102-J16-P', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000029-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000030-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0104-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000030-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000031-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0105-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000031-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000032-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0105-J16-P', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000032-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000033-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0107-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000033-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000034-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0108-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000034-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000035-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0109-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000035-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000036-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0112-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000036-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000037-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0113-H03S-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000037-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000038-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '2-H-28-12-0114-H03S-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000038-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000039-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '2-MT-28-29-0202-J47-N', 'Methanol', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000039-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000040-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '2-MT-28-29-0713-J48-N', 'Methanol', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000040-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000041-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '2-V-28-22-0101-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000041-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000042-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '2-V-28-22-0102-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000042-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000043-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '2-V-28-22-0103-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000043-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000044-0000-0000-0000-000000000001'::uuid, 'sy000099-0000-0000-0000-000000000001'::uuid, '2-VT-28-99-GP-2801-J16-N', 'Vessel Trim', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000044-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000045-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '3-DH-28-31-0108-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000045-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000046-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '3-DH-28-31-0109-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000046-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000047-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '3-DH-28-31-0110-B03-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000047-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000048-0000-0000-0000-000000000001'::uuid, 'sy000031-0000-0000-0000-000000000001'::uuid, '3-DH-28-31-0414-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000048-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000049-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '3-H-28-12-0113-H03S-N', 'Process Fluid', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000049-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000050-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '3-V-28-22-0101-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000050-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000051-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '3-V-28-22-0102-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000051-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000052-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '3-V-28-22-0103-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000052-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000053-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '3-V-28-22-0105-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000053-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000054-0000-0000-0000-000000000001'::uuid, 'sy000022-0000-0000-0000-000000000001'::uuid, '3-V-28-22-0105-D03-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000054-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000055-0000-0000-0000-000000000001'::uuid, 'sy000029-0000-0000-0000-000000000001'::uuid, '3/4-MT-28-29-0202-J47-N', 'Methanol', '3/4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000055-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000056-0000-0000-0000-000000000001'::uuid, 'sy000021-0000-0000-0000-000000000001'::uuid, '3/4-N-28-21-0201-J48-N', 'Nitrogen', '3/4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000056-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000057-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '4-H-28-12-0102-J16-P', 'Process Fluid', '4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000057-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000058-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '4-H-28-12-0112-J16-N', 'Process Fluid', '4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000058-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000059-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '6-H-28-12-0328-J26S-P', 'Process Fluid', '6')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000059-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000060-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0102-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000060-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000061-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0102-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000061-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000062-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0103-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000062-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000063-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0104-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000063-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000064-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0105-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000064-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000065-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0123-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000065-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000066-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0223-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000066-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000067-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0328-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000067-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000068-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0331-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000068-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000069-0000-0000-0000-000000000001'::uuid, 'sy000012-0000-0000-0000-000000000001'::uuid, '8-H-28-12-0332-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000069-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('ln000070-0000-0000-0000-000000000001'::uuid, 'sy000018-0000-0000-0000-000000000001'::uuid, '8-H-28-18-0101-J20-N', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('pd000000-0000-0000-0000-000000000001'::uuid, 'ln000070-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT DO NOTHING;

-- Storage config (local)
INSERT INTO storage_config (id, scope_type, scope_id, provider, is_active, base_path) VALUES
  ('sc000000-0000-0000-0000-000000000001'::uuid, 'platform', 'pl000000-0000-0000-0000-000000000001'::uuid, 'local', true, '/app/storage')
ON CONFLICT DO NOTHING;

SELECT 'Seed data loaded: 1 platform, 8 systems, 1 P&ID, ' ||
  '104 equipment, 65 instruments, 70 lines' AS status;
