import type { app, dialog, shell } from 'electron';

export interface ExposedMeta {
  handlers: [string, string[]][];
  events: [string, string[]][];
}

// render <-> helper
export interface RendererToHelper {
  postEvent: (channel: string, ...args: any[]) => void;
}

export interface HelperToRenderer {
  [key: string]: (...args: any[]) => Promise<any>;
}

// helper <-> main
export interface HelperToMain {
  getMeta: () => ExposedMeta;
}

export interface LocalBackupPreferences {
  enabled: boolean;
  destination?: string;
  lastSuccess?: number;
  lastAttempt?: number;
  lastError?: string;
}

export type MainToHelper = Pick<
  typeof dialog & typeof shell & typeof app,
  | 'showOpenDialog'
  | 'showSaveDialog'
  | 'openExternal'
  | 'showItemInFolder'
  | 'getPath'
> & {
  getLocalBackupPreferences: (
    workspaceId: string
  ) => LocalBackupPreferences | undefined;
  setLocalBackupPreferences: (
    workspaceId: string,
    preferences: LocalBackupPreferences
  ) => void;
};

export const NOTA_API_CHANNEL_NAME = 'nota-ipc-api';
export const NOTA_EVENT_CHANNEL_NAME = 'nota-ipc-event';
export const NOTA_EVENT_SUBSCRIBE_CHANNEL_NAME = 'nota-ipc-event-subscribe';
