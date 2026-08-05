import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3001/api/v1';
const PLATFORM_WHT5 = 'd0000000-0000-0000-0000-000000000001';
const PLATFORM_WHT6 = 'd0000000-0000-0000-0000-000000000002';
const SYSTEM_PV019 = 'e0000000-0000-0000-0000-000000000001';
const SYSTEM_CD = 'e0000000-0000-0000-0000-000000000009';
const PNID_15101 = 'f0000000-0000-0000-0000-000000000001';
const LINE_1195AD = '10000000-0000-0000-0000-000000000001';
const EQUIP_PV019XT = '20000000-0000-0000-0000-000000000001';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

// ═══════════════════════════════════════════
// P2.1 — Database Verification
// ═══════════════════════════════════════════

describe('P2.1 Database — row counts', () => {
  it('should have 2 platforms', async () => {
    const { body } = await get('/platforms');
    assert.equal(body.platforms.length, 2);
  });

  it('should have 12 systems on WHT-5', async () => {
    const { body } = await get(`/platforms/${PLATFORM_WHT5}/systems`);
    assert.equal(body.systems.length, 12);
  });

  it('should have 2 systems on WHT-6', async () => {
    const { body } = await get(`/platforms/${PLATFORM_WHT6}/systems`);
    assert.equal(body.systems.length, 2);
  });

  it('should have 22 P&IDs on WHT-5 (24 total, 2 on WHT-6)', async () => {
    const { body } = await get(`/pnids?platform_id=${PLATFORM_WHT5}`);
    assert.equal(body.pnids.length, 22);
  });

  it('should have 13 lines across WHT-5', async () => {
    const { body } = await get(`/lines?platform_id=${PLATFORM_WHT5}`);
    assert.equal(body.lines.length, 13);
  });

  it('should have 17 equipment across WHT-5', async () => {
    const { body } = await get(`/equipment?platform_id=${PLATFORM_WHT5}`);
    assert.equal(body.equipment.length, 17);
  });

  it('should have 12 instruments across WHT-5', async () => {
    const { body } = await get(`/instruments?platform_id=${PLATFORM_WHT5}`);
    assert.equal(body.instruments.length, 12);
  });
});

describe('P2.1 Database — cross-system P&ID references', () => {
  it('P&ID 15101 should have 4 systems (PV019 primary, CD/SC/GL secondary)', async () => {
    const { body } = await get(`/pnids/${PNID_15101}/systems`);
    assert.equal(body.systems.length, 4);
    const primary = body.systems.find(s => s.isPrimary);
    assert.equal(primary.code, 'PV019');
    const secondary = body.systems.filter(s => !s.isPrimary).map(s => s.code).sort();
    assert.deepEqual(secondary, ['CD', 'GL', 'SC']);
  });
});

describe('P2.1 Database — line continuation', () => {
  it('Line CO-6"-EC12NLD-1195AD should appear on 15101 (origin) and 15117 (continuation)', async () => {
    const { body } = await get(`/lines/${LINE_1195AD}`);
    assert.equal(body.line.lineNumber, 'CO-6"-EC12NLD-1195AD');
    assert.ok(body.pnids.length >= 2, 'Line should appear on at least 2 P&IDs');
    const p15101 = body.pnids.find(p => p.drawingNumber.includes('15101'));
    const p15117 = body.pnids.find(p => p.drawingNumber.includes('15117'));
    assert.ok(p15101, 'Should appear on 15101');
    assert.ok(p15117, 'Should appear on 15117');
    assert.equal(p15101.isContinuation, false);
    assert.equal(p15117.isContinuation, true);
  });
});

// ═══════════════════════════════════════════
// P2.2 — Backend API Endpoints
// ═══════════════════════════════════════════

describe('P2.2 API — Health', () => {
  it('GET /health should return ok', async () => {
    const res = await fetch('http://localhost:3001/health');
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});

describe('P2.2 API — Platforms', () => {
  it('GET /platforms should return array with id, code, name, status', async () => {
    const { body } = await get('/platforms');
    assert.ok(Array.isArray(body.platforms));
    const wht5 = body.platforms.find(p => p.code === 'WHT-5');
    assert.ok(wht5);
    assert.ok(wht5.id);
    assert.ok(wht5.name);
    assert.ok(wht5.status);
  });

  it('GET /platforms/:id should return detail with counts', async () => {
    const { body } = await get(`/platforms/${PLATFORM_WHT5}`);
    assert.ok(body.platform);
    assert.equal(body.platform.code, 'WHT-5');
    assert.equal(body.platform.systemCount, 12);
    assert.equal(body.platform.pnidCount, 22);
    assert.equal(body.platform.equipmentCount, 17);
    assert.equal(body.platform.instrumentCount, 12);
  });

  it('GET /platforms/:invalid should return 404', async () => {
    const { status } = await get('/platforms/00000000-0000-0000-0000-000000000099');
    assert.equal(status, 404);
  });
});

describe('P2.2 API — Systems (Miller Column 1)', () => {
  it('GET /platforms/:id/systems should return systems with counts', async () => {
    const { body } = await get(`/platforms/${PLATFORM_WHT5}/systems`);
    assert.ok(Array.isArray(body.systems));
    const pv019 = body.systems.find(s => s.code === 'PV019');
    assert.ok(pv019);
    assert.equal(pv019.sysType, 'process');
    assert.ok(typeof pv019.lineCount === 'number');
    assert.ok(typeof pv019.equipmentCount === 'number');
    assert.ok(typeof pv019.primaryPnidCount === 'number');
  });

  it('should filter by sys_type', async () => {
    const { body } = await get(`/platforms/${PLATFORM_WHT5}/systems?sys_type=safety`);
    body.systems.forEach(s => assert.equal(s.sysType, 'safety'));
  });
});

describe('P2.2 API — P&IDs (Miller Column 2)', () => {
  it('GET /pnids?system_id should return P&IDs for system', async () => {
    const { body } = await get(`/pnids?system_id=${SYSTEM_PV019}`);
    assert.ok(Array.isArray(body.pnids));
    assert.ok(body.pnids.length > 0);
    body.pnids.forEach(p => {
      assert.ok(p.id);
      assert.ok(p.drawingNumber);
      assert.ok(p.title);
      assert.ok(typeof p.hasImage === 'boolean');
      assert.ok(typeof p.lineCount === 'number');
    });
  });

  it('should return isPrimary flag relative to queried system', async () => {
    const { body } = await get(`/pnids?system_id=${SYSTEM_PV019}`);
    const p15101 = body.pnids.find(p => p.drawingNumber.includes('15101'));
    assert.ok(p15101);
    assert.equal(p15101.isPrimary, true, 'P&ID 15101 should be primary for PV019');
  });

  it('include_xref=false should filter out non-primary P&IDs', async () => {
    const withXref = await get(`/pnids?system_id=${SYSTEM_CD}`);
    const withoutXref = await get(`/pnids?system_id=${SYSTEM_CD}&include_xref=false`);
    assert.ok(withXref.body.pnids.length >= withoutXref.body.pnids.length,
      'With xref should return >= without xref');
  });

  it('GET /pnids/:id should return P&ID detail with annotations', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    assert.ok(body.pnid);
    assert.equal(body.pnid.drawingNumber, 'AD219-490-D-15101');
    assert.equal(body.pnid.hasImage, true);
    assert.ok(body.pnid.imagePath);
    assert.ok(Array.isArray(body.systems));
    assert.ok(body.annotations);
    assert.ok(Array.isArray(body.annotations.equipment));
    assert.ok(Array.isArray(body.annotations.instruments));
  });
});

describe('P2.2 API — Lines (Miller Column 3)', () => {
  it('GET /lines?pnid_id should return lines on a P&ID', async () => {
    const { body } = await get(`/lines?pnid_id=${PNID_15101}`);
    assert.ok(Array.isArray(body.lines));
    assert.ok(body.lines.length > 0);
    body.lines.forEach(l => {
      assert.ok(l.lineNumber);
      assert.ok(l.ownerSystemCode);
      assert.ok(typeof l.isCrossReference === 'boolean');
      assert.ok(typeof l.isContinuation === 'boolean');
    });
  });

  it('GET /lines?system_id should return owned lines', async () => {
    const { body } = await get(`/lines?system_id=${SYSTEM_PV019}`);
    assert.ok(body.lines.length > 0);
    const ownedLine = body.lines.find(l => !l.isCrossReference);
    assert.ok(ownedLine);
    assert.equal(ownedLine.ownerSystemId, SYSTEM_PV019);
  });

  it('lines on P&ID 15101 should include cross-references', async () => {
    const { body } = await get(`/lines?pnid_id=${PNID_15101}`);
    const xrefs = body.lines.filter(l => l.isCrossReference);
    assert.ok(xrefs.length > 0, 'P&ID 15101 should have cross-reference lines');
  });

  it('GET /lines/:id should return line detail with pnids and equipment', async () => {
    const { body } = await get(`/lines/${LINE_1195AD}`);
    assert.ok(body.line);
    assert.equal(body.line.lineNumber, 'CO-6"-EC12NLD-1195AD');
    assert.ok(body.ownerSystem);
    assert.ok(Array.isArray(body.pnids));
    assert.ok(Array.isArray(body.equipment));
    assert.ok(Array.isArray(body.instruments));
  });

  it('GET /lines without params should return 400', async () => {
    const { status } = await get('/lines');
    assert.equal(status, 400);
  });
});

describe('P2.2 API — Equipment (Miller Column 4)', () => {
  it('GET /equipment?pnid_id should return equipment on P&ID', async () => {
    const { body } = await get(`/equipment?pnid_id=${PNID_15101}`);
    assert.ok(Array.isArray(body.equipment));
    assert.ok(body.equipment.length > 0);
    body.equipment.forEach(e => {
      assert.ok(e.tag);
      assert.ok(e.equipmentType);
      assert.ok(typeof e.isStandalone === 'boolean');
    });
  });

  it('GET /equipment?line_id should return equipment on line', async () => {
    const { body } = await get(`/equipment?line_id=${LINE_1195AD}`);
    assert.ok(Array.isArray(body.equipment));
    body.equipment.forEach(e => {
      assert.equal(e.lineId, LINE_1195AD);
    });
  });

  it('GET /equipment?system_id should return all equipment for system', async () => {
    const { body } = await get(`/equipment?system_id=${SYSTEM_PV019}`);
    assert.ok(body.equipment.length > 0);
    body.equipment.forEach(e => {
      assert.equal(e.systemId, SYSTEM_PV019);
    });
  });

  it('GET /equipment/:id should return detail', async () => {
    const { body } = await get(`/equipment/${EQUIP_PV019XT}`);
    assert.ok(body.equipment);
    assert.equal(body.equipment.tag, 'PV019-XT');
    assert.ok(body.system);
    assert.ok(Array.isArray(body.pnids));
  });

  it('GET /equipment without params should return 400', async () => {
    const { status } = await get('/equipment');
    assert.equal(status, 400);
  });
});

describe('P2.2 API — Instruments (Miller Column 5)', () => {
  it('GET /instruments?pnid_id should return instruments on P&ID', async () => {
    const { body } = await get(`/instruments?pnid_id=${PNID_15101}`);
    assert.ok(Array.isArray(body.instruments));
    assert.ok(body.instruments.length > 0);
    body.instruments.forEach(i => {
      assert.ok(i.tag);
      assert.ok(i.instrumentType);
    });
  });

  it('GET /instruments?system_id should return instruments for system', async () => {
    const { body } = await get(`/instruments?system_id=${SYSTEM_PV019}`);
    assert.ok(body.instruments.length > 0);
    body.instruments.forEach(i => {
      assert.equal(i.systemId, SYSTEM_PV019);
    });
  });

  it('GET /instruments without params should return 400', async () => {
    const { status } = await get('/instruments');
    assert.equal(status, 400);
  });
});

describe('P2.2 API — Cascade Filtering', () => {
  it('selecting system PV019 → P&IDs → should filter lines correctly', async () => {
    // Get P&IDs for PV019
    const pnids = await get(`/pnids?system_id=${SYSTEM_PV019}`);
    const firstPnid = pnids.body.pnids[0];
    assert.ok(firstPnid);

    // Get lines for that P&ID
    const lines = await get(`/lines?pnid_id=${firstPnid.id}`);
    assert.ok(lines.body.lines.length > 0, 'P&ID should have lines');

    // Get equipment for that P&ID
    const equip = await get(`/equipment?pnid_id=${firstPnid.id}`);
    assert.ok(Array.isArray(equip.body.equipment));
  });

  it('selecting line → equipment should cascade', async () => {
    const lines = await get(`/lines?system_id=${SYSTEM_PV019}`);
    const lineWithEquip = lines.body.lines.find(l => l.equipmentCount > 0);
    if (lineWithEquip) {
      const equip = await get(`/equipment?line_id=${lineWithEquip.id}`);
      assert.ok(equip.body.equipment.length > 0);
    }
  });
});

describe('P2.2 API — Registers', () => {
  it('GET /registers/pnids should return paginated P&ID register', async () => {
    const { body } = await get(`/registers/pnids?platform_id=${PLATFORM_WHT5}`);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.total > 0);
    assert.ok(body.data[0].drawingNumber);
    assert.ok(body.data[0].primarySystem);
  });

  it('GET /registers/lines should return line register', async () => {
    const { body } = await get(`/registers/lines?platform_id=${PLATFORM_WHT5}`);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.total > 0);
    assert.ok(body.data[0].lineNumber);
  });

  it('GET /registers/equipment should return equipment register', async () => {
    const { body } = await get(`/registers/equipment?platform_id=${PLATFORM_WHT5}`);
    assert.ok(Array.isArray(body.data));
    assert.equal(body.total, 17);
    assert.ok(body.data[0].tag);
  });

  it('GET /registers/instruments should return instrument register', async () => {
    const { body } = await get(`/registers/instruments?platform_id=${PLATFORM_WHT5}`);
    assert.ok(Array.isArray(body.data));
    assert.equal(body.total, 12);
    assert.ok(body.data[0].tag);
  });

  it('should support sorting', async () => {
    const asc = await get(`/registers/equipment?platform_id=${PLATFORM_WHT5}&sort_by=tag&sort_dir=asc`);
    const desc = await get(`/registers/equipment?platform_id=${PLATFORM_WHT5}&sort_by=tag&sort_dir=desc`);
    assert.notEqual(asc.body.data[0].tag, desc.body.data[0].tag);
  });

  it('should support filtering', async () => {
    const { body } = await get(`/registers/equipment?platform_id=${PLATFORM_WHT5}&filter[tag]=PV019`);
    assert.ok(body.data.length > 0);
    body.data.forEach(e => assert.ok(e.tag.includes('PV019')));
  });

  it('GET /registers/invalid should return 400', async () => {
    const { status } = await get(`/registers/invalid?platform_id=${PLATFORM_WHT5}`);
    assert.equal(status, 400);
  });
});

describe('P2.2 API — Search', () => {
  it('should find equipment by tag', async () => {
    const { body } = await get(`/search?platform_id=${PLATFORM_WHT5}&q=PV019`);
    assert.ok(body.results.length > 0);
    body.results.forEach(r => {
      assert.ok(r.entityType);
      assert.ok(r.entityId);
      assert.ok(r.tag);
    });
  });

  it('should find instruments by tag', async () => {
    const { body } = await get(`/search?platform_id=${PLATFORM_WHT5}&q=PT-019`);
    assert.ok(body.results.length > 0);
  });

  it('should return 400 without required params', async () => {
    const { status } = await get('/search');
    assert.equal(status, 400);
  });
});

// ═══════════════════════════════════════════
// P2.4 — P&ID Viewer Data
// ═══════════════════════════════════════════

describe('P2.4 P&ID Viewer — annotation data', () => {
  it('P&ID 15101 should have 6 equipment annotations', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    assert.equal(body.annotations.equipment.length, 6);
  });

  it('P&ID 15101 should have 3 instrument annotations', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    assert.equal(body.annotations.instruments.length, 3);
  });

  it('annotations should have percentage positions (0-100)', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    [...body.annotations.equipment, ...body.annotations.instruments].forEach(a => {
      assert.ok(a.tag, 'annotation should have tag');
      const x = parseFloat(a.xPct);
      const y = parseFloat(a.yPct);
      const w = parseFloat(a.wPct);
      const h = parseFloat(a.hPct);
      assert.ok(x >= 0 && x <= 100, `xPct ${x} out of range for ${a.tag}`);
      assert.ok(y >= 0 && y <= 100, `yPct ${y} out of range for ${a.tag}`);
      assert.ok(w > 0 && w <= 100, `wPct ${w} out of range for ${a.tag}`);
      assert.ok(h > 0 && h <= 100, `hPct ${h} out of range for ${a.tag}`);
    });
  });

  it('P&ID 15101 should have imagePath set', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    assert.ok(body.pnid.imagePath, 'imagePath should be set');
    assert.ok(body.pnid.hasImage, 'hasImage should be true');
  });

  it('P&ID detail should include systems with primary flag', async () => {
    const { body } = await get(`/pnids/${PNID_15101}`);
    const primary = body.systems.find(s => s.isPrimary);
    assert.ok(primary, 'Should have a primary system');
    assert.equal(primary.code, 'PV019');
    assert.equal(primary.sysType, 'process');
  });

  it('P&IDs list should include hasImage flag for viewer button', async () => {
    const { body } = await get(`/pnids?platform_id=${PLATFORM_WHT5}`);
    const withImage = body.pnids.filter(p => p.hasImage);
    assert.ok(withImage.length >= 1, 'At least one P&ID should have an image');
    const p15101 = body.pnids.find(p => p.drawingNumber.includes('15101'));
    assert.equal(p15101.hasImage, true);
  });
});
