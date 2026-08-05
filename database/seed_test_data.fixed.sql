-- ═══════════════════════════════════════════════════════════════════
-- SEED TEST DATA — 1 P&ID end-to-end test
-- P&ID: AD-28-D-100001-SHT-001 (Production Lines)
-- ═══════════════════════════════════════════════════════════════════

-- Hierarchy: Client → Project → Concession → Location → Complex → Platform
INSERT INTO client (id, name, code) VALUES
  ('00000000-0000-4000-8000-000000000001'::uuid, 'ADNOC Offshore', 'ADNOC')
ON CONFLICT DO NOTHING;

INSERT INTO project (id, client_id, name, code) VALUES
  ('00000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'AS-BUILT Recovery Phase II', 'ABR2')
ON CONFLICT DO NOTHING;

INSERT INTO concession (id, name, code, project_id) VALUES
  ('00000000-0000-4000-8000-000000000003'::uuid, 'Abu Dhabi Block 219', 'AD219', '00000000-0000-4000-8000-000000000002'::uuid)
ON CONFLICT DO NOTHING;

INSERT INTO location (id, concession_id, name, code) VALUES
  ('00000000-0000-4000-8000-000000000004'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, 'Abu Al Bukhoosh', 'ABK')
ON CONFLICT DO NOTHING;

INSERT INTO complex (id, location_id, name, code) VALUES
  ('00000000-0000-4000-8000-000000000005'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, 'ABK Complex', 'ABK')
ON CONFLICT DO NOTHING;

INSERT INTO platform (id, complex_id, name, code, status) VALUES
  ('00000000-0000-4000-8000-000000000006'::uuid, '00000000-0000-4000-8000-000000000005'::uuid, 'AKK4 Well Head Platform', 'AD28', 'operating')
ON CONFLICT DO NOTHING;

-- Systems
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-000000000007'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '12', 'Production', 'process')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-000000000008'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '18', 'Test / Metering', 'process')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-000000000009'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '21', 'Nitrogen', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-00000000000a'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '22', 'Vent', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-00000000000b'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '27', 'Fire Water', 'safety')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-00000000000c'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '29', 'Chemical Injection', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-00000000000d'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '31', 'Closed Drain', 'utility')
ON CONFLICT DO NOTHING;
INSERT INTO system (id, platform_id, code, name, sys_type) VALUES
  ('00000000-0000-4000-8000-00000000000e'::uuid, '00000000-0000-4000-8000-000000000006'::uuid, '99', 'Vessel Trim', 'process')
ON CONFLICT DO NOTHING;

-- P&ID: AD-28-D-100001-SHT-001
INSERT INTO pnid (id, drawing_number, title, revision, status, sheet_number, total_sheets, storage_key) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, 'AD-28-D-100001-SHT-001', 'Production Lines P&ID', '1', 'approved', 1, 1, 'pids/AD-28-D-100001-SHT-001.pdf')
ON CONFLICT DO NOTHING;

-- P&ID ↔ System junctions
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, true)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-000000000008'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-000000000009'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO pnid_system (pnid_id, system_id, is_primary) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-00000000000e'::uuid, false)
ON CONFLICT DO NOTHING;

-- Equipment
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000010'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'P-2802.C', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000011'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'AF-09', 'Wellhead', 'Annular Flow Equipment', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000012'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'LT-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000013'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-06', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000014'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-04', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000015'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-05', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000016'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-02', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000017'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-09', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000018'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-06', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000019'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'SSV-289920.C', 'Equipment', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PT-289901.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001b'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-05', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001c'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PT-289901.A/B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001d'::uuid, '00000000-0000-4000-8000-00000000000e'::uuid, 'CRANE', 'Crane', 'Platform Crane', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001e'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-06', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000001f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-07', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000020'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-04', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000021'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-02', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000022'::uuid, '00000000-0000-4000-8000-00000000000e'::uuid, 'Q-2801', 'Heat Exchanger', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000023'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-01', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000024'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'GP-2802', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000025'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-07', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000026'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-01', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000027'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-08', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000028'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-07', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000029'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, 'Q-2803', 'Heat Exchanger', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002a'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.B-03', 'Hydraulic Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002b'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, 'LT-283010', 'Equipment', 'Part of Q-2803', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002c'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Q-2802', 'Heat Exchanger', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002d'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-05', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002e'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, 'GP-2801', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000002f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'SSV-289920.A', 'Equipment', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000030'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'P-2802.B', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000031'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'SSV-289920.B', 'Equipment', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000032'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-03', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000033'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'AF-10', 'Wellhead', 'Annular Flow Equipment', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000034'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-02', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000035'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'P-2802.A', 'Pump', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000036'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'WV-289930.C', 'Wing Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000037'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-08', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000038'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-01', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000039'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'WV-289930.A', 'Wing Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'G-2802', 'Generator Package', NULL, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003b'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-09', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003c'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'WV-289930.B', 'Wing Valve', 'Part of AF-09', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003d'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.A-03', 'Hydraulic Valve', 'Part of AF-4', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003e'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HV-289920.C-04', 'Hydraulic Valve', 'Part of AF-10', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000003f'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Needle Valve-0112', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000040'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3971', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000041'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10878', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000042'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Needle Valve-0111', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000043'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'V-28196', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000044'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10884', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000045'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3968', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000046'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10879', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000047'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'V-28200', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000048'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'DBBT-1182', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000049'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Gate Valve-2322', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Gate Valve-2325', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004b'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'DBBT-1181', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004c'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3974', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004d'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3969', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004e'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'V-28195', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000004f'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3970', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000050'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10874', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000051'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10875', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000052'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Check Valve-3748', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000053'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10876', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000054'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'DBBT-1180', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000055'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10880', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000056'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10882', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000057'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'V-28198', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000058'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3972', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000059'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Check Valve-3750', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'DBBT-1183', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005b'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10877', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005c'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Gate Valve-2324', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005d'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3973', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005e'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10885', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000005f'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Check Valve-3749', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000060'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'V-28197', 'Vessel', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000061'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10883', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000062'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Gate Valve-2326', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000063'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Ball Valve-10881', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000064'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Globe Valve-3975', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000065'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Gate Valve-2323', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000066'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PG-282010.B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000067'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PG-282010.A', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000068'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'LT-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000069'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PT-289901.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006a'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'LG-282020', 'Level Gauge', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006b'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'LSLL-282020', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006c'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PSV-282020.C', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006d'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PT-289901.B', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006e'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8738', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-00000000006f'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8735', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000070'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PT-289901.A', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000071'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8736', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000072'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PSV-282020.B', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000073'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PG-282010.C', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000074'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'PSV-282020.A', 'Pressure Safety Valve', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000075'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8733', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000076'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8734', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO equipment (id, system_id, tag, equipment_type, description, criticality) VALUES
  ('00000000-0000-4000-8000-000000000077'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, 'Component-8737', 'Package Equipment', 'Part of G-2802', NULL)
ON CONFLICT DO NOTHING;

-- Instruments
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000078'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.04', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000079'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281031', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007a'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289941.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007b'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281014.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007c'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281045.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007d'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HCV-281040.A', 'control_valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007e'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289951', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000007f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289943.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000080'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.02', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000081'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000082'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281010.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000083'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FT-281010.C', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000084'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281015.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000085'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289945.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000086'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289962', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000087'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281010.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000088'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.05', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000089'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281014.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008a'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289941.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008b'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281020.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008c'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281013.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008d'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281040.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008e'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.07', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000008f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289944.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000090'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281013.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000091'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HCV-281040.C', 'control_valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000092'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281014.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000093'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289942.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000094'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289945.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000095'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281010.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000096'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289941.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000097'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289940.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000098'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-000000000099'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289961', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009a'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FI-281010.C2', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009b'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289944.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009c'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.B/281040.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009d'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281015.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009e'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FT-281010.A', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-00000000009f'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281020.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a0'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FI-281010.A2', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.C/281040.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281040.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'HCV-281040.B', 'control_valve', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a4'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281016.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a5'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289340.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a6'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281013.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a7'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.06', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a8'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.08', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000a9'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.03', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000aa'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'DGTC-287700.01', 'analyzer', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000ab'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281020.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000ac'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSLL-289940.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000ad'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281010.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000ae'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281015.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000af'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281012.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b0'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'TT-281010.A', 'temperature', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b1'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281030', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b2'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FI-281010.B2', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b3'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.A/PT-281045.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b4'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'FT-281010.B', 'flow', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b5'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281044.C', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b6'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PT-281010.B', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b7'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PG-281017.A', 'pressure', NULL)
ON CONFLICT DO NOTHING;
INSERT INTO instrument (id, system_id, tag, instrument_type, description) VALUES
  ('00000000-0000-4000-8000-0000000000b8'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, 'PSHH-289950', 'pressure', NULL)
ON CONFLICT DO NOTHING;

-- Lines (referenced on AD-28-D-100001-SHT-001)
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000b9'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '1-DH-28-31-0414-B06S-N', 'Closed Drain', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000b9'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ba'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-H-28-12-0105-J16-P', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ba'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000bb'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-H-28-12-0113-H03S-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000bb'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000bc'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-H-28-12-0114-H03S-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000bc'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000bd'::uuid, '00000000-0000-4000-8000-000000000008'::uuid, '1-H-28-18-0101-J16-N', 'Process Fluid', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000bd'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000be'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-JC-28-29-0201-J16-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000be'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000bf'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-JC-28-29-0201-J47-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000bf'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c0'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-JC-28-29-0201-J48-N', 'HP Corrosion Inhibitor', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c0'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-MT-28-29-0201-J16-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c1'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c2'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-MT-28-29-0201-J47-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c2'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c3'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-MT-28-29-0202-J47-N', 'Methanol', '1')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c3'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c4'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-1/2-H-28-12-0105-J16-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c4'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c5'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-1/2-H-28-12-0107-J16-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c5'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c6'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '1-1/2-H-28-12-0113-H03S-N', 'Process Fluid', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c6'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c7'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-1/2-MT-28-29-0110-J48-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c7'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c8'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-1/2-MT-28-29-0201-J47-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c8'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000c9'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '1-1/2-MT-28-29-0202-J47-N', 'Methanol', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000c9'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ca'::uuid, '00000000-0000-4000-8000-000000000009'::uuid, '1-1/2-N-28-21-0201-J47-N', 'Nitrogen', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ca'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000cb'::uuid, '00000000-0000-4000-8000-000000000009'::uuid, '1-1/2-N-28-21-0201-J48-N', 'Nitrogen', '1-1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000cb'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000cc'::uuid, '00000000-0000-4000-8000-000000000009'::uuid, '1/2-N-28-21-0201-J47-N', 'Nitrogen', '1/2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000cc'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000cd'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0101-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000cd'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ce'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0103-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ce'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000cf'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0104-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000cf'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d0'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0105-B03-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d0'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d1'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0108-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d1'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d2'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0109-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d2'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d3'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '2-DH-28-31-0414-B06S-N', 'Closed Drain', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d3'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d4'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0102-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d4'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d5'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0102-J16-P', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d5'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d6'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0104-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d6'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d7'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0105-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d7'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d8'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0105-J16-P', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d8'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000d9'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0107-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000d9'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000da'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0108-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000da'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000db'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0109-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000db'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000dc'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0112-J16-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000dc'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000dd'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0113-H03S-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000dd'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000de'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '2-H-28-12-0114-H03S-N', 'Process Fluid', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000de'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000df'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '2-MT-28-29-0202-J47-N', 'Methanol', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000df'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e0'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '2-MT-28-29-0713-J48-N', 'Methanol', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e0'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e1'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '2-V-28-22-0101-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e1'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e2'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '2-V-28-22-0102-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e2'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e3'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '2-V-28-22-0103-B16-N', 'Vent', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e3'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e4'::uuid, '00000000-0000-4000-8000-00000000000e'::uuid, '2-VT-28-99-GP-2801-J16-N', 'Vessel Trim', '2')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e4'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e5'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '3-DH-28-31-0108-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e5'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e6'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '3-DH-28-31-0109-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e6'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e7'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '3-DH-28-31-0110-B03-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e7'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e8'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, '3-DH-28-31-0414-B06S-N', 'Closed Drain', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e8'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000e9'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '3-H-28-12-0113-H03S-N', 'Process Fluid', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000e9'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ea'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '3-V-28-22-0101-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ea'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000eb'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '3-V-28-22-0102-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000eb'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ec'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '3-V-28-22-0103-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ec'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ed'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '3-V-28-22-0105-B16-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ed'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ee'::uuid, '00000000-0000-4000-8000-00000000000a'::uuid, '3-V-28-22-0105-D03-N', 'Vent', '3')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ee'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000ef'::uuid, '00000000-0000-4000-8000-00000000000c'::uuid, '3/4-MT-28-29-0202-J47-N', 'Methanol', '3/4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000ef'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f0'::uuid, '00000000-0000-4000-8000-000000000009'::uuid, '3/4-N-28-21-0201-J48-N', 'Nitrogen', '3/4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f0'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f1'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '4-H-28-12-0102-J16-P', 'Process Fluid', '4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f1'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f2'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '4-H-28-12-0112-J16-N', 'Process Fluid', '4')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f2'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f3'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '6-H-28-12-0328-J26S-P', 'Process Fluid', '6')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f3'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f4'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0102-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f4'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f5'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0102-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f5'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f6'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0103-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f6'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f7'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0104-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f7'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f8'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0105-J16-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f8'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000f9'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0123-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000f9'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000fa'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0223-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000fa'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000fb'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0328-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000fb'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000fc'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0331-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000fc'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000fd'::uuid, '00000000-0000-4000-8000-000000000007'::uuid, '8-H-28-12-0332-J26S-P', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000fd'::uuid, false)
ON CONFLICT DO NOTHING;
INSERT INTO line (id, system_id, line_number, service, nominal_size) VALUES
  ('00000000-0000-4000-8000-0000000000fe'::uuid, '00000000-0000-4000-8000-000000000008'::uuid, '8-H-28-18-0101-J20-N', 'Process Fluid', '8')
ON CONFLICT DO NOTHING;
INSERT INTO pnid_line (pnid_id, line_id, is_continuation) VALUES
  ('00000000-0000-4000-8000-00000000000f'::uuid, '00000000-0000-4000-8000-0000000000fe'::uuid, false)
ON CONFLICT DO NOTHING;

-- Storage config (local)
INSERT INTO storage_config (id, scope_type, scope_id, provider, is_active, base_path) VALUES
  ('00000000-0000-4000-8000-0000000000ff'::uuid, 'platform', '00000000-0000-4000-8000-000000000006'::uuid, 'local', true, '/app/storage')
ON CONFLICT DO NOTHING;

SELECT 'Seed data loaded: 1 platform, 8 systems, 1 P&ID, ' ||
  '104 equipment, 65 instruments, 70 lines' AS status;
