// Launches a packaged (or dev) Nota build and checks that it actually starts:
// a renderer page loads and React mounts into #app. A build whose bundle,
// asar or main process cannot start fails here, before anything is published.
//
//   node scripts/smoke-desktop-app.ts --app <executable> [--timeout 120] [-- extra electron args]
//
// It drives the app through Chromium's remote debugging port, so it needs no
// code in the app itself. Node's built-in fetch/WebSocket are enough (Node 22).
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
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

type Target = { type: string; url: string; webSocketDebuggerUrl?: string };

async function listTargets(port: number): Promise<Target[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return response.ok ? ((await response.json()) as Target[]) : [];
  } catch {
    return [];
  }
}

// Evaluates an expression in a page over the DevTools protocol.
function evaluate(webSocketUrl: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('DevTools evaluate timed out'));
    }, 10_000);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        })
      );
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result?.result?.value);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('DevTools socket error'));
    });
  });
}

const port = await freePort();
const home = mkdtempSync(join(tmpdir(), 'nota-smoke-'));
const output: string[] = [];
const child = spawn(app, [`--remote-debugging-port=${port}`, ...extraArgs], {
  // Fresh profile and home so the smoke run never touches real user data
  // and always starts from first launch, like a new install.
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    ELECTRON_ENABLE_LOGGING: '1',
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

let result = 'no renderer page appeared';
let ok = false;
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  if (exitCode !== null) {
    result = `app exited early with code ${exitCode}`;
    break;
  }
  const pages = (await listTargets(port)).filter(
    target =>
      target.type === 'page' &&
      target.webSocketDebuggerUrl &&
      !target.url.startsWith('devtools://') &&
      target.url !== 'about:blank'
  );
  for (const page of pages) {
    try {
      const state = (await evaluate(
        page.webSocketDebuggerUrl as string,
        "`${document.readyState}|${document.getElementById('app')?.childElementCount ?? -1}`"
      )) as string | undefined;
      result = `page ${page.url.slice(0, 80)} state ${state}`;
      const [readyState, children] = (state ?? '').split('|');
      if (readyState === 'complete' && Number(children) > 0) {
        ok = true;
      }
    } catch (error) {
      result = `page ${page.url.slice(0, 80)}: ${(error as Error).message}`;
    }
    if (ok) break;
  }
  if (ok) break;
  await sleep(1000);
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
