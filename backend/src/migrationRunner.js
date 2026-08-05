import prisma from './db.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In Docker, database/ is mounted at /app/database; locally it's at ../../database
const RELATIVE_DIR = join(__dirname, '..', '..', 'database');
const DOCKER_DIR = join(__dirname, '..', 'database');
const MIGRATIONS_DIR = existsSync(RELATIVE_DIR) ? RELATIVE_DIR : DOCKER_DIR;

/**
 * Splits a SQL file into individual statements, correctly handling
 * DO $$ ... END $$; blocks (which contain semicolons inside).
 * Strips BEGIN/COMMIT since Prisma manages its own transactions.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;
  const lines = sql.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip pure comment lines (but keep them inside DO blocks)
    if (!inDollarBlock && trimmed.startsWith('--')) continue;

    // Detect DO $$ or $$ block start
    if (!inDollarBlock && /\$\$/.test(trimmed)) {
      inDollarBlock = true;
      current += line + '\n';

      // Check if the block also ends on this same line (e.g. DO $$ BEGIN ... END $$;)
      const matches = trimmed.match(/\$\$/g);
      if (matches && matches.length >= 2) {
        inDollarBlock = false;
        // The statement ends here
        const stmt = current.trim().replace(/;$/, '');
        if (stmt.length > 0) statements.push(stmt);
        current = '';
      }
      continue;
    }

    // Inside a DO $$ block — look for the closing $$
    if (inDollarBlock) {
      current += line + '\n';
      if (/\$\$/.test(trimmed)) {
        inDollarBlock = false;
        // The statement ends at the closing $$;
        const stmt = current.trim().replace(/;$/, '');
        if (stmt.length > 0) statements.push(stmt);
        current = '';
      }
      continue;
    }

    // Normal SQL — split on semicolons
    current += line + '\n';
    if (trimmed.endsWith(';')) {
      const stmt = current.trim().replace(/;$/, '');
      if (stmt.length > 0
          && !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmt)
          && !/^SELECT\s+'[^']*'\s+AS\s+/i.test(stmt)) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Flush any remaining content
  const remaining = current.trim().replace(/;$/, '');
  if (remaining.length > 0 && !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(remaining)) {
    statements.push(remaining);
  }

  return statements;
}

function isDatabaseUnavailableError(message = '') {
  return /can't reach database|econnrefused|connection refused|starting up|not yet accepting connections|consistent recovery state/i.test(
    message,
  );
}

/**
 * Runs all migration SQL files from the database/ directory.
 * Each migration uses IF NOT EXISTS / idempotent patterns so safe to re-run.
 */
export async function runMigrations({ dryRun = false } = {}) {
  const results = { applied: 0, skipped: 0, errors: [], migrations: [] };

  if (!existsSync(MIGRATIONS_DIR)) {
    results.errors.push('database/ directory not found — migrations skipped');
    return results;
  }

  // Also check subdirectories (e.g. database/migrations/)
  const migrationDirs = [MIGRATIONS_DIR];
  const subMigrationsDir = join(MIGRATIONS_DIR, 'migrations');
  if (existsSync(subMigrationsDir)) {
    migrationDirs.push(subMigrationsDir);
  }

  let allFiles = [];
  for (const dir of migrationDirs) {
    const dirFiles = readdirSync(dir)
      .filter(f => f.startsWith('migration') && f.endsWith('.sql'))
      .map(f => ({ name: f, path: join(dir, f) }));
    allFiles.push(...dirFiles);
  }
  // Also pick up numbered migrations in subdirectory (e.g. 003_topology_edges.sql)
  if (existsSync(subMigrationsDir)) {
    const numberedFiles = readdirSync(subMigrationsDir)
      .filter(f => /^\d+.*\.sql$/.test(f) && !allFiles.some(af => af.name === f))
      .map(f => ({ name: f, path: join(subMigrationsDir, f) }));
    allFiles.push(...numberedFiles);
  }
  allFiles.sort((a, b) => a.name.localeCompare(b.name));

  // Fail fast when the database is down — avoids hundreds of per-statement warnings.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    if (isDatabaseUnavailableError(err.message)) {
      results.errors.push(`Database unavailable: ${err.message}`);
      return results;
    }
    throw err;
  }

  for (const file of allFiles) {
    try {
      const sql = readFileSync(file.path, 'utf8');

      if (dryRun) {
        results.migrations.push({ file: file.name, status: 'pending' });
        results.skipped++;
        continue;
      }

      const statements = splitStatements(sql);
      let statementsRun = 0;

      for (const stmt of statements) {
        try {
          await prisma.$executeRawUnsafe(stmt);
          statementsRun++;
        } catch (stmtErr) {
          if (isDatabaseUnavailableError(stmtErr.message)) {
            throw new Error(`Database unavailable during ${file.name}: ${stmtErr.message}`);
          }
          // IF NOT EXISTS / already exists errors are expected — skip them
          if (stmtErr.message.includes('already exists') || stmtErr.message.includes('duplicate')) {
            continue;
          }
          // Log but don't fail the whole migration
          console.warn(`Migration ${file.name} statement warning: ${stmtErr.message}`);
        }
      }

      results.migrations.push({ file: file.name, status: 'applied', statements: statementsRun });
      results.applied++;
    } catch (err) {
      results.migrations.push({ file: file.name, status: 'error', error: err.message });
      results.errors.push(`${file.name}: ${err.message}`);
    }
  }

  return results;
}
