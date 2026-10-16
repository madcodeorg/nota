import { Button, Menu, MenuItem, MenuTrigger } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import { useEffect, useRef, useState } from 'react';

import * as styles from './style.css';

export type DiscoveredModel = { id: string; name: string };

export function readDiscoveredModels(payload: unknown): DiscoveredModel[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.filter(
    (model): model is DiscoveredModel =>
      !!model && typeof model.id === 'string' && typeof model.name === 'string'
  );
}

export function ProviderModelDiscovery({
  provider,
  disabled,
  onModelChange,
}: {
  provider: string;
  disabled: boolean;
  onModelChange: (id: string) => void;
}) {
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const discover = async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/ai/providers/${encodeURIComponent(provider)}/models`,
        { signal: request.signal }
      );
      const body = (await response.json()) as { error?: string };
      if (request.signal.aborted) return;
      if (!response.ok || body.error)
        throw new Error(
          body.error || 'Model discovery is unavailable for this provider.'
        );
      const discovered = readDiscoveredModels(body);
      setModels(discovered);
      if (!discovered.length)
        setMessage('No catalog available. Enter a model ID manually.');
    } catch (error) {
      if (!request.signal.aborted)
        setMessage(
          `${error instanceof Error ? error.message : String(error)} You can still enter a model ID manually.`
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
      controller.current = null;
    }
  };
  return (
    <>
      <SettingRow
        name="Provider catalog"
        desc="Uses saved credentials. Save changes before discovery. A listed model does not verify generation or tool support."
      >
        <Button disabled={disabled || busy} onClick={() => void discover()}>
          {busy ? 'Loading models…' : 'Discover models'}
        </Button>
      </SettingRow>
      {models.length ? (
        <SettingRow name="Discovered models">
          <Menu
            items={models.map(model => (
              <MenuItem key={model.id} onSelect={() => onModelChange(model.id)}>
                {model.name}
              </MenuItem>
            ))}
          >
            <MenuTrigger
              className={styles.menuTrigger}
              disabled={disabled}
              aria-label="Discovered models"
            >
              Choose model
            </MenuTrigger>
          </Menu>
        </SettingRow>
      ) : null}
      {message ? (
        <div className={styles.notice} role="status">
          {message}
        </div>
      ) : null}
    </>
  );
}
