import prisma from '../src/db.js';
import { createDrawSession, addManualSegment, getSession } from '../src/services/smartIdentification/index.js';

const pnidId = 'd0000000-0000-0000-0000-000000000001';

const { session } = await createDrawSession(pnidId);
console.log('session', session.id);

const seg = await addManualSegment(pnidId, session.id, {
  segmentType: 'line',
  geometry: { points: [{ xPct: 10, yPct: 10 }, { xPct: 50, yPct: 10 }] },
  metadata: { source: 'manual' },
  displayColor: '#2D33E0',
});

console.log('segment', seg.id);
const loaded = await getSession(pnidId, session.id);
console.log('loaded segments', loaded.segments.length);

await prisma.$disconnect();
