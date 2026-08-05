/**
 * Stop all AssetView dev backend processes and free port 3001.
 * Run before starting dev if you see "Backend offline" or EADDRINUSE.
 */
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(backendRoot, '..');

function run(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: true });
  } catch {
    /* ignore */
  }
}

if (process.platform === 'win32') {
  // Kill anything listening on 3001
  run(`node "${join(backendRoot, 'scripts', 'freePort.mjs')}" 3001`);

  // Kill orphaned node --watch src/server.js from this project (multiple npm run dev sessions)
  try {
    const ps = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'src\\\\server\\.js' -and $_.CommandLine -match 'assetview' } | ForEach-Object { $_.ProcessId }"`,
      { encoding: 'utf8' },
    );
    for (const pid of ps.trim().split(/\s+/).filter(Boolean)) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[stopDev] Killed backend PID ${pid}`);
      } catch { /* gone */ }
    }
  } catch { /* none */ }

  // Kill concurrently dev runners for this project
  try {
    const ps = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'concurrently' -and $_.CommandLine -match 'dev:backend' } | ForEach-Object { $_.ProcessId }"`,
      { encoding: 'utf8' },
    );
    for (const pid of ps.trim().split(/\s+/).filter(Boolean)) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[stopDev] Killed concurrently PID ${pid}`);
      } catch { /* gone */ }
    }
  } catch { /* none */ }
} else {
  run(`node "${join(backendRoot, 'scripts', 'freePort.mjs')}" 3001`);
  run(`pkill -f "${projectRoot}/backend/src/server.js" 2>/dev/null`);
}

console.log('[stopDev] Port 3001 cleared. Start fresh with: npm run dev');
