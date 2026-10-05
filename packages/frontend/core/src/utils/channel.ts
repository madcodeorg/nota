import { z } from 'zod';

export const appSchemes = z.enum([
  'nota',
  'nota-canary',
  'nota-beta',
  'nota-internal',
  'nota-dev',
]);

export type Scheme = z.infer<typeof appSchemes>;
export type Channel = 'stable' | 'canary' | 'beta' | 'internal';

export const schemeToChannel = {
  nota: 'stable',
  'nota-canary': 'canary',
  'nota-beta': 'beta',
  'nota-internal': 'internal',
  'nota-dev': 'canary', // dev does not have a dedicated app. use canary as the placeholder.
} as Record<Scheme, Channel>;

export const channelToScheme = {
  stable: 'nota',
  canary: BUILD_CONFIG.debug ? 'nota-dev' : 'nota-canary',
  beta: 'nota-beta',
  internal: 'nota-internal',
} as Record<Channel, Scheme>;

export const appIconMap = {
  stable: '/imgs/app-icon-stable.ico',
  canary: '/imgs/app-icon-canary.ico',
  beta: '/imgs/app-icon-beta.ico',
  internal: '/imgs/app-icon-internal.ico',
} satisfies Record<Channel, string>;

export const appNames = {
  stable: 'Nota',
  canary: 'Nota Canary',
  beta: 'Nota Beta',
  internal: 'Nota Internal',
} satisfies Record<Channel, string>;

export const appSchemaUrl = z.custom<string>(
  (url: string) => {
    try {
      return appSchemes.safeParse(new URL(url).protocol.replace(':', ''))
        .success;
    } catch {
      return false;
    }
  },
  { message: 'Invalid URL or protocol' }
);
