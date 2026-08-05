import prisma from '../src/db.js';
import { getStorageProvider } from '../src/services/storage/index.js';
import { existsSync } from 'fs';
import { join } from 'path';

const pnidId = process.argv[2] || 'd0000000-0000-0000-0000-000000000000';

const pnid = await prisma.pnid.findFirst({ where: { id: pnidId } });
const links = await prisma.pnid_system.findMany({
  where: { pnid_id: pnidId },
  include: { system: { select: { platform_id: true, name: true } } },
});

console.log('pnid:', pnid?.drawing_number, pnid?.storage_key);
const platformId = links[0]?.system?.platform_id;
console.log('platformId:', platformId);

try {
  const storage = await getStorageProvider(prisma, { platformId });
  console.log('basePath:', storage.basePath);
  const full = join(storage.basePath, pnid.storage_key);
  console.log('fullPath:', full);
  console.log('exists:', existsSync(full));
  try {
    await storage.download(pnid.storage_key);
    console.log('download: OK');
  } catch (e) {
    console.log('download error:', e.message);
  }
} catch (e) {
  console.log('storage error:', e.message);
}

await prisma.$disconnect();
