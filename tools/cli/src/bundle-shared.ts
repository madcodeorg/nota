import type { Configuration as RspackDevServerConfiguration } from '@rspack/dev-server';

export const RSPACK_SUPPORTED_PACKAGES = [
  '@nota/admin',
  '@nota/web',
  '@nota/mobile',
  '@nota/ios',
  '@nota/android',
  '@nota/electron-renderer',
  '@nota/reader',
] as const;

const rspackSupportedPackageSet = new Set<string>(RSPACK_SUPPORTED_PACKAGES);

export function isRspackSupportedPackageName(name: string) {
  return rspackSupportedPackageSet.has(name);
}

export function assertRspackSupportedPackageName(name: string) {
  if (isRspackSupportedPackageName(name)) {
    return;
  }

  throw new Error(
    `Rspack bundling currently supports: ${Array.from(RSPACK_SUPPORTED_PACKAGES).join(', ')}. Unsupported package: ${name}.`
  );
}

const IN_CI = !!process.env.CI;
const httpProxyMiddlewareLogLevel = IN_CI ? 'silent' : 'error';
const localBackendFallbackEnabled =
  process.env.NOTA_DEV_BACKEND_FALLBACK !== 'false';

function setLocalCorsHeaders(res: {
  setHeader: (name: string, value: string) => void;
}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'authorization',
      'content-type',
      'x-nota-csrf-token',
      'x-nota-version',
      'x-operation-name',
    ].join(', ')
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

type DevServerRequest = {
  method?: string;
  url?: string;
};

type DevServerResponse = {
  end: (data?: string) => void;
  setHeader: (name: string, value: string) => void;
  statusCode: number;
};

export const DEFAULT_DEV_SERVER_CONFIG: RspackDevServerConfiguration = {
  host: '0.0.0.0',
  allowedHosts: 'all',
  hot: false,
  liveReload: true,
  compress: !process.env.CI,
  setupExitSignals: true,
  client: {
    overlay: process.env.DISABLE_DEV_OVERLAY === 'true' ? false : undefined,
    logging: process.env.CI ? 'none' : 'error',
    // see: https://webpack.js.org/configuration/dev-server/#websocketurl
    // must be an explicit ws/wss URL because custom protocols (e.g. assets://)
    // cannot be used to construct WebSocket endpoints in Electron
    webSocketURL: 'ws://0.0.0.0:8080/ws',
  },
  historyApiFallback: {
    rewrites: [
      {
        from: /.*/,
        to: () => {
          return process.env.SELF_HOSTED === 'true'
            ? '/selfhost.html'
            : '/index.html';
        },
      },
    ],
  },
  setupMiddlewares: (middlewares, devServer) => {
    devServer.app?.use(
      (req: DevServerRequest, res: DevServerResponse, next: () => void) => {
        const url = req.url ?? '';
        const isCloudProbe =
          url.startsWith('/api/auth/session') ||
          url.startsWith('/api/telemetry/collect') ||
          url.startsWith('/graphql');

        if (isCloudProbe) {
          setLocalCorsHeaders(res);
        }

        if (req.method === 'OPTIONS' && isCloudProbe) {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (localBackendFallbackEnabled) {
          if (req.method === 'GET' && url.startsWith('/api/auth/session')) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ user: null }));
            return;
          }

          if (req.method === 'POST' && url.startsWith('/graphql')) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: {} }));
            return;
          }

          if (
            req.method === 'POST' &&
            url.startsWith('/api/telemetry/collect')
          ) {
            res.statusCode = 204;
            res.end();
            return;
          }
        }

        next();
      }
    );

    return middlewares;
  },
  proxy: [
    {
      context: '/api',
      target: 'http://localhost:3010',
      logLevel: httpProxyMiddlewareLogLevel,
    },
    {
      context: '/v1',
      target: 'http://localhost:3010',
      logLevel: httpProxyMiddlewareLogLevel,
    },
    {
      context: '/socket.io',
      target: 'http://localhost:3010',
      ws: true,
      logLevel: httpProxyMiddlewareLogLevel,
    },
    {
      context: '/graphql',
      target: 'http://localhost:3010',
      logLevel: httpProxyMiddlewareLogLevel,
    },
  ],
};
