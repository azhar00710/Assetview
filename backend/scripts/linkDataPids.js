/**
 * Point local storage at data/ and sync P&ID storage keys to match PDF filenames there.
 * Usage: node scripts/linkDataPids.js
 */

import prisma from '../src/db.js';
import { clearProviderCache } from '../src/services/storage/index.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data').replace(/\\/g, '/');

async function main() {
  // All AD-28 platform storage configs → data folder
  const updated = await prisma.$executeRaw`
    UPDATE storage_config
    SET base_path = ${DATA_DIR},
        updated_at = NOW()
    WHERE provider = 'local'
      AND scope_type = 'platform'
      AND scope_id = 'a2000000-0000-0000-0000-000000000001'::uuid
  `;
  console.log('Updated storage base_path →', DATA_DIR);

  const pnids = await prisma.pnid.findMany({
    where: { deleted_at: null, drawing_number: { startsWith: 'AD-28-' } },
    select: { id: true, drawing_number: true, storage_key: true },
  });

  let synced = 0;
  for (const pnid of pnids) {
    const fileName = `${pnid.drawing_number}.pdf`;
    const filePath = join(DATA_DIR.replace(/\//g, '\\'), fileName);
    if (!existsSync(filePath)) {
      console.warn(`Missing PDF: ${fileName}`);
      continue;
    }
    await prisma.pnid.update({
      where: { id: pnid.id },
      data: {
        storage_key: fileName,
        has_image: true,
        uploaded_at: new Date(),
      },
    });
    console.log(`Synced ${pnid.drawing_number} → ${fileName}`);
    synced++;
  }

  clearProviderCache();
  console.log(`Done. ${synced} P&IDs linked to data/ folder. Restart backend to clear storage cache.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
