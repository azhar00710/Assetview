/**
 * Run DB migrations once before the dev server starts (not on every --watch restart).
 */
import { runMigrations } from '../src/migrationRunner.js';
import prisma from '../src/db.js';

console.log('Checking database migrations...');
const result = await runMigrations({ dryRun: false });

if (result.applied > 0) {
  console.log(`Applied ${result.applied} migration(s):`);
  for (const m of result.migrations) {
    console.log(`  ${m.status === 'applied' ? '✓' : '✗'} ${m.file} — ${m.statements ?? 0} statements ${m.error ? `(ERROR: ${m.error})` : ''}`);
  }
} else {
  console.log('Database schema is up to date');
}
if (result.errors.length > 0) {
  console.error('Migration errors:', result.errors);
  process.exit(1);
}

await prisma.$disconnect();
process.exit(0);
