import { finalizeMeetingsBeforeShutdown } from './meetings';
import { createServer } from './server';

type UtilityParentPort = {
  on(event: 'message', listener: (event: unknown) => void): void;
  postMessage(message: unknown): void;
};

function messageData(event: unknown) {
  if (event && typeof event === 'object' && 'data' in event) {
    return (event as { data: unknown }).data;
  }
  return event;
}

async function start() {
  const { app, config, ready } = createServer();
  await ready;

  const parentPort = (
    process as NodeJS.Process & { parentPort?: UtilityParentPort }
  ).parentPort;

  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const port =
      typeof address === 'object' && address ? address.port : config.port;
    config.port = port;
    console.log(
      `Nota AI backend listening on http://${config.host}:${port} using ${config.defaultProvider}:${config.defaultModel}`
    );

    parentPort?.postMessage({
      host: config.host,
      instanceId: process.env.NOTA_AI_INSTANCE_ID ?? null,
      port,
      type: 'nota-ai-backend-ready',
      workspaceRoot: config.workspaceRoot,
    });
  });

  let shutdown: Promise<void> | null = null;
  parentPort?.on('message', event => {
    const message = messageData(event);
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'nota-ai-backend-shutdown'
    ) {
      return;
    }

    shutdown ??= (async () => {
      // Stop accepting new work, but leave current requests connected while
      // meeting queues, STT tails, search content, and session state persist.
      server.close();
      await finalizeMeetingsBeforeShutdown(config);
      server.closeAllConnections?.();
      parentPort.postMessage({ type: 'nota-ai-backend-shutdown-complete' });
      process.exit(0);
    })();
    shutdown.catch(error => {
      console.error('[ai-backend] graceful shutdown failed', error);
      process.exit(1);
    });
  });
}

void start().catch(error => {
  console.error('[ai-backend] failed to start', error);
  process.exitCode = 1;
});
