/**
 * Stable local dev entry: free port → migrate once → watch src/ only (fast restarts).
 */
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args = []) {
  execSync([cmd, ...args].join(' '), { cwd: backendRoot, stdio: 'inherit', shell: true });
}

run('node', ['scripts/ensureEnv.mjs']);
run('node', ['scripts/ensureDatabase.mjs']);
run('node', ['scripts/freePort.mjs', '3001']);
run('node', ['scripts/runMigrations.mjs']);
run('node', ['scripts/freePort.mjs', '3001']);

const child = spawn(
  process.execPath,
  ['--watch-path=src', '--watch', 'src/server.js'],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SKIP_STARTUP_MIGRATIONS: '1',
    },
  },
);

function shutdown() {
  child.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

child.on('exit', (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
