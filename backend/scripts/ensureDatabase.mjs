/**
 * Ensure PostgreSQL is running before backend migrations / API start.
 * - Waits for an existing DB connection
 * - On localhost, auto-starts the assetview-db Docker container when stopped
 * - Fails fast with actionable errors instead of hundreds of migration warnings
 */
import dotenv from 'dotenv';
import net from 'net';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(backendRoot, '..');
const CONTAINER_NAME = 'assetview-db';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

dotenv.config({ path: join(backendRoot, '.env') });

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://assetview:assetview@localhost:5432/assetview';

function parseDatabaseUrl(url) {
  try {
    const normalized = url.replace(/^postgresql:\/\//, 'http://');
    const parsed = new URL(normalized);
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port || 5432),
    };
  } catch {
    return { host: 'localhost', port: 5432 };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runQuiet(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: true, ...opts }).trim();
  } catch {
    return null;
  }
}

function dockerAvailable() {
  return runQuiet('docker info') !== null;
}

function containerRunning(name) {
  const status = runQuiet(`docker inspect --format "{{.State.Running}}" ${name}`);
  return status === 'true';
}

function containerExists(name) {
  return runQuiet(`docker inspect --format "{{.Name}}" ${name}`) !== null;
}

function containerHealthy(name) {
  const health = runQuiet(`docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" ${name}`);
  return health === 'healthy' || health === 'none';
}

function checkTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function canQueryDatabase(prisma) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function startDockerPostgres() {
  if (!dockerAvailable()) {
    console.error('[ensureDatabase] Docker is not running.');
    console.error('  Start Docker Desktop, then run: docker compose up -d postgres');
    return false;
  }

  if (containerRunning(CONTAINER_NAME)) {
    return true;
  }

  if (containerExists(CONTAINER_NAME)) {
    console.log(`[ensureDatabase] Starting ${CONTAINER_NAME}...`);
    try {
      execSync(`docker update --restart unless-stopped ${CONTAINER_NAME}`, { stdio: 'ignore', shell: true });
      execSync(`docker start ${CONTAINER_NAME}`, { stdio: 'inherit', shell: true });
      return true;
    } catch {
      return false;
    }
  }

  const composeFile = join(projectRoot, 'docker-compose.yml');
  if (!existsSync(composeFile)) {
    console.error('[ensureDatabase] docker-compose.yml not found — cannot create postgres container.');
    return false;
  }

  console.log('[ensureDatabase] Creating postgres via docker compose...');
  try {
    execSync('docker compose up -d postgres', { cwd: projectRoot, stdio: 'inherit', shell: true });
    return true;
  } catch {
    return false;
  }
}

async function waitForDatabase({ host, port, prisma, maxWaitMs = 90000 }) {
  const started = Date.now();
  let attempt = 0;
  let dockerStarted = false;

  while (Date.now() - started < maxWaitMs) {
    attempt += 1;

    if (await canQueryDatabase(prisma)) {
      return true;
    }

    const portOpen = await checkTcp(host, port);
    if (!portOpen && isLocalDb(host) && !dockerStarted) {
      dockerStarted = startDockerPostgres();
      if (dockerStarted) {
        await sleep(1500);
        continue;
      }
    }

    if (containerRunning(CONTAINER_NAME) && !containerHealthy(CONTAINER_NAME)) {
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(`[ensureDatabase] Waiting for ${CONTAINER_NAME} health check...`);
      }
    } else if (attempt === 1 || attempt % 5 === 0) {
      console.log(`[ensureDatabase] Waiting for PostgreSQL at ${host}:${port}...`);
    }

    await sleep(Math.min(800 + attempt * 150, 2500));
  }

  return false;
}

function isLocalDb(host) {
  return LOCAL_HOSTS.has(String(host || '').toLowerCase());
}

const { host, port } = parseDatabaseUrl(DATABASE_URL);
const prisma = new PrismaClient();

try {
  if (await canQueryDatabase(prisma)) {
    console.log(`[ensureDatabase] PostgreSQL ready (${host}:${port})`);
    process.exit(0);
  }

  console.log(`[ensureDatabase] PostgreSQL not reachable at ${host}:${port}`);

  if (isLocalDb(host)) {
    startDockerPostgres();
  }

  const ready = await waitForDatabase({ host, port, prisma });
  if (!ready) {
    console.error('');
    console.error('[ensureDatabase] PostgreSQL did not become ready in time.');
    console.error('  Try:');
    console.error('    docker compose up -d postgres');
    console.error('    docker logs assetview-db');
    console.error('  Or use: npm run start:win');
    console.error('');
    process.exit(1);
  }

  console.log(`[ensureDatabase] PostgreSQL ready (${host}:${port})`);
  process.exit(0);
} catch (err) {
  console.error('[ensureDatabase] Failed:', err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
