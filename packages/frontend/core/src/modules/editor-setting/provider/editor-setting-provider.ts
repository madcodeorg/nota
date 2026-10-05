import { createIdentifier } from '@nota/infra';
import type { Observable } from 'rxjs';

export interface EditorSettingProvider {
  set(key: string, value: string): void;
  watchAll(): Observable<Record<string, string>>;
}

export const EditorSettingProvider = createIdentifier<EditorSettingProvider>(
  'EditorSettingProvider'
);
