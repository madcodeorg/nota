// Launches a packaged (or dev) Nota build and checks that it actually starts:
// a renderer page loads and React mounts into #app. A build whose bundle,
// asar or main process cannot start fails here, before anything is published.
//
//   node scripts/smoke-desktop-app.ts --app <executable> [--timeout 120] [-- extra electron args]
//
// Packaged builds ignore --remote-debugging-port, so the app reports itself:
// with NOTA_SMOKE_TEST=<file> it writes that file once the UI has mounted
// (src/main/smoke-test.ts) and exits.
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const ownArgs = separator === -1 ? argv : argv.slice(0, separator);
const extraArgs = separator === -1 ? [] : argv.slice(separator + 1);

function option(name: string): string | undefined {
  const index = ownArgs.indexOf(name);
  return index === -1 ? undefined : ownArgs[index + 1];
}

const app = option('--app');
const timeoutMs = Number(option('--timeout') ?? 120) * 1000;
if (!app) {
  console.error('Usage: smoke-desktop-app.ts --app <executable> [--timeout s]');
  process.exit(2);
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    return;
  }
  try {
    // Negative pid: the app was started as a process group leader.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

const realAppData = process.env.APPDATA;
const home = mkdtempSync(join(tmpdir(), 'nota-smoke-'));
const resultFile = join(home, 'smoke-result.txt');
const output: string[] = [];
const child = spawn(app, extraArgs, {
  // Fresh profile and home so the smoke run never touches real user data and
  // always starts from first launch, like a new install.
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    ELECTRON_ENABLE_LOGGING: '1',
    NOTA_SMOKE_TEST: resultFile,
  },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let exitCode: number | null = null;
child.on('exit', code => {
  exitCode = code ?? -1;
});
for (const stream of [child.stdout, child.stderr]) {
  stream?.on('data', chunk => {
    output.push(String(chunk));
    if (output.length > 400) output.shift();
  });
}

let result = 'the UI did not mount before the timeout';
let ok = false;
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  if (existsSync(resultFile)) {
    result = `UI mounted at ${readFileSync(resultFile, 'utf8')}`;
    ok = true;
    break;
  }
  if (exitCode !== null) {
    // The result file is written just before the app exits.
    await sleep(500);
    if (existsSync(resultFile)) continue;
    result = `app exited early with code ${exitCode}`;
    break;
  }
  await sleep(500);
}

// Recent *.log files under a directory, for the failure report. Electron
// ignores the APPDATA override on Windows, so the app's real logs live there.
function recentLogs(dir: string | undefined, depth = 0): string[] {
  if (!dir || depth > 4 || !existsSync(dir)) return [];
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (stat.isDirectory()) found.push(...recentLogs(path, depth + 1));
      else if (name.endsWith('.log') && Date.now() - stat.mtimeMs < 15 * 60_000)
        found.push(path);
    } catch {
      // ignore unreadable entries
    }
  }
  return found;
}

if (!ok) {
  const trace = `${resultFile}.trace`;
  console.error('--- app trace ---');
  console.error(existsSync(trace) ? readFileSync(trace, 'utf8') : '(empty)');
  for (const log of [
    ...recentLogs(realAppData),
    ...recentLogs(join(home, '.config')),
  ].slice(0, 6)) {
    console.error(`--- ${log} ---`);
    console.error(readFileSync(log, 'utf8').slice(-3000));
  }
}

if (!ok && process.platform === 'win32') {
  // Is the process alive, responding, or did Windows log a crash?
  const run = (command: string, args: string[]) =>
    spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 }).stdout;
  console.error('--- tasklist ---');
  console.error(
    run('tasklist', ['/v', '/fo', 'list', '/fi', `pid eq ${child.pid}`])
  );
  console.error('--- application event log (last 10 min) ---');
  console.error(
    run('powershell', [
      '-NoProfile',
      '-Command',
      "Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddMinutes(-10)} -MaxEvents 12 -ErrorAction SilentlyContinue | Format-List TimeCreated,ProviderName,Message | Out-String -Width 220",
    ])?.slice(0, 5000)
  );
}

killTree(child);
await sleep(500);
try {
  rmSync(home, { recursive: true, force: true });
} catch {
  // Best effort: Windows may still hold a handle for a moment.
}

if (ok) {
  console.log(`Smoke test passed: ${result}`);
  process.exit(0);
}
console.error(`Smoke test FAILED: ${result}`);
console.error('--- last app output ---');
console.error(output.join('').slice(-6000));
process.exit(1);
