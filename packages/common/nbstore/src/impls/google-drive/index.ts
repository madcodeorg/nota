import type { StorageConstructor } from '..';
import { GoogleDriveBlobStorage } from './blob';
import { GoogleDriveDocStorage } from './doc';

export * from './blob';
export * from './connection';
export * from './doc';

export const googleDriveStorages = [
  GoogleDriveDocStorage,
  GoogleDriveBlobStorage,
] satisfies StorageConstructor[];
