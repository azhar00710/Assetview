/**
 * Free a TCP port before starting the dev server (fixes EADDRINUSE on Windows with node --watch).
 * Usage: node scripts/freePort.mjs [port]
 */
import { execSync } from 'child_process';

const port = Number(process.argv[2] || process.env.PORT || 3001);

function freePortWin(targetPort) {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let killed = false;
    try {
      const out = execSync(`netstat -ano | findstr ":${targetPort}" | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`[freePort] Killed PID ${pid} on port ${targetPort}`);
          killed = true;
        } catch {
          /* already gone */
        }
      }
    } catch {
      return; // port is free
    }
    if (!killed) return;
    // Wait for Windows to release the socket (timeout.exe fails in some PowerShell hosts)
    try {
      execSync('powershell -NoProfile -Command "Start-Sleep -Seconds 1"', { stdio: 'ignore' });
    } catch {
      /* best effort */
    }
  }
}

function freePortUnix(targetPort) {
  try {
    execSync(`lsof -ti:${targetPort} | xargs -r kill -9`, { stdio: 'ignore', shell: true });
  } catch {
    /* nothing listening */
  }
}

if (process.platform === 'win32') freePortWin(port);
else freePortUnix(port);
