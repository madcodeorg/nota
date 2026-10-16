import { Button, Menu, MenuItem, MenuTrigger } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type DiscoveredModel,
  readDiscoveredModels,
} from './provider-model-discovery';
import * as styles from './style.css';

const EMPTY_MODELS: DiscoveredModel[] = [];

export type ChatGPTStatus = {
  connected: boolean;
  planEnabled: boolean;
  activeProfileId?: string | null;
  profiles: Array<{
    id: string;
    email?: string;
    name?: string;
    connected: boolean;
    planEnabled: boolean;
  }>;
  pending: boolean;
  error?: string | null;
};

export function validatedChatGPTAuthUrl(value: unknown) {
  if (typeof value !== 'string')
    throw new Error('Invalid ChatGPT sign-in URL.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'auth.openai.com' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('Invalid ChatGPT sign-in URL.');
  }
  return url.href;
}

async function chatgptRequest<T>(
  route: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`/api/ai/chatgpt/${route}`, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(payload.error || 'ChatGPT connection is unavailable.');
  return payload;
}

export function ChatGPTConnection({
  disabled,
  openExternal,
  onModelsChanged,
  model,
  onModelChange,
  showModelSettings = true,
  showCatalogRefresh = showModelSettings,
  compact = false,
  collapseAccountControls = false,
  onStatusChange,
  onCatalogChange,
}: {
  disabled: boolean;
  openExternal: (url: string) => void;
  onModelsChanged: () => Promise<void>;
  model: string;
  onModelChange: (model: string) => void;
  showModelSettings?: boolean;
  showCatalogRefresh?: boolean;
  compact?: boolean;
  collapseAccountControls?: boolean;
  onStatusChange?: (status: ChatGPTStatus | null) => void;
  onCatalogChange?: (models: DiscoveredModel[]) => void;
}) {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{
    profileId: string | null;
    models: DiscoveredModel[];
  } | null>(null);
  const models =
    status?.connected &&
    !busy &&
    status.planEnabled &&
    !status.pending &&
    catalog?.profileId === (status.activeProfileId ?? null)
      ? catalog.models
      : EMPTY_MODELS;
  useEffect(() => {
    onStatusChange?.(busy && status ? { ...status, pending: true } : status);
  }, [onStatusChange, status, busy]);
  useEffect(() => {
    onCatalogChange?.(models);
  }, [onCatalogChange, models]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const catalogRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const action = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const requestRevision = revision.current;
    chatgptRequest<ChatGPTStatus>('status', undefined, controller.signal)
      .then(next => {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          revision.current === requestRevision
        )
          setStatus(next);
      })
      .catch(() => {
        if (mounted.current && !controller.signal.aborted)
          setError('ChatGPT connection is unavailable in this backend.');
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!status?.pending || busy) return;
    const controller = new AbortController();
    const requestRevision = revision.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await chatgptRequest<ChatGPTStatus>(
          'status',
          undefined,
          controller.signal
        );
        if (controller.signal.aborted || requestRevision !== revision.current)
          return;
        setStatus(next);
        if (!next.pending) return;
      } catch (error) {
        if (controller.signal.aborted || requestRevision !== revision.current)
          return;
        setError(error instanceof Error ? error.message : String(error));
        setStatus(current =>
          current ? { ...current, pending: false } : current
        );
        return;
      }
      timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [status?.pending, busy]);

  const refreshCatalog = useCallback(async () => {
    if (!status?.connected || !status.planEnabled || status.pending) return;
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      const body = await chatgptRequest<unknown>(
        'models',
        undefined,
        controller.signal
      );
      if (!controller.signal.aborted) {
        setCatalog({
          profileId: status.activeProfileId ?? null,
          models: readDiscoveredModels(body),
        });
        setStatus(current =>
          current?.error ? { ...current, error: null } : current
        );
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setCatalog(null);
      if (!controller.signal.aborted)
        setCatalogError(
          error instanceof Error
            ? error.message
            : 'Unable to load ChatGPT models.'
        );
      try {
        const next = await chatgptRequest<ChatGPTStatus>(
          'status',
          undefined,
          controller.signal
        );
        if (!controller.signal.aborted) setStatus(next);
      } catch {
        if (!controller.signal.aborted) {
          setStatus(null);
          setError(
            'ChatGPT connection status cannot currently be verified. Try signing in again.'
          );
        }
      }
    } finally {
      if (!controller.signal.aborted) setCatalogBusy(false);
    }
  }, [
    status?.connected,
    status?.planEnabled,
    status?.pending,
    status?.activeProfileId,
  ]);

  useEffect(() => {
    catalogRequest.current?.abort();
    setCatalog(null);
    setCatalogError(null);
    setCatalogBusy(false);
    if (busy || !status?.connected || !status.planEnabled || status.pending)
      return;
    refreshCatalog().catch(() => {});
    onModelsChanged().catch(() => {});
    const controller = catalogRequest.current;
    return () => controller?.abort();
  }, [
    status?.activeProfileId,
    status?.connected,
    status?.planEnabled,
    status?.pending,
    busy,
    onModelsChanged,
    refreshCatalog,
  ]);
  useEffect(() => () => catalogRequest.current?.abort(), []);

  const perform = useCallback(
    async (route: string, body: unknown = {}) => {
      if (action.current || disabled) return;
      action.current = true;
      revision.current++;
      // Stop catalog/status recovery before an account action can replace it.
      catalogRequest.current?.abort();
      setCatalog(null);
      setCatalogBusy(false);
      setBusy(true);
      setError(null);
      try {
        const result = await chatgptRequest<{ url?: string }>(route, body);
        if (!mounted.current) return;
        if (route === 'sign-in') {
          try {
            openExternal(validatedChatGPTAuthUrl(result.url));
          } catch {
            await chatgptRequest('cancel', {}).catch(() => {});
            throw new Error(
              'Unable to open a valid ChatGPT sign-in URL. Try signing in again.'
            );
          }
          setStatus(current => ({
            ...(current ?? {
              connected: false,
              planEnabled: false,
              profiles: [],
            }),
            pending: true,
          }));
        } else {
          const next = await chatgptRequest<ChatGPTStatus>('status');
          if (!mounted.current) return;
          setStatus(next);
          await onModelsChanged();
        }
      } catch (error) {
        if (mounted.current)
          setError(error instanceof Error ? error.message : String(error));
      } finally {
        action.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [disabled, onModelsChanged, openExternal]
  );

  const activeProfile = status?.profiles.find(
    profile => profile.id === status.activeProfileId
  );
  const pending = status?.pending ?? false;
  const unavailable = disabled || busy;
  const rowProps = compact
    ? { spreadCol: false, className: styles.chatgptCompactRow }
    : undefined;
  const accountControls = (
    <>
      {status?.profiles.length ? (
        <SettingRow {...rowProps} name="Account">
          <Menu
            items={status.profiles.map(profile => (
              <MenuItem
                key={profile.id}
                selected={profile.id === status.activeProfileId}
                disabled={unavailable || pending}
                onSelect={() =>
                  void perform('select-profile', { profileId: profile.id })
                }
              >
                {profile.name || profile.email || 'ChatGPT account'}
              </MenuItem>
            ))}
          >
            <MenuTrigger
              className={styles.menuTrigger}
              disabled={unavailable || pending}
              aria-label="ChatGPT account"
            >
              {activeProfile?.name || activeProfile?.email || 'Choose account'}
            </MenuTrigger>
          </Menu>
        </SettingRow>
      ) : null}
      {status?.connected ? (
        <SettingRow {...rowProps} name="Connection">
          <div className={styles.chatgptCompactActions}>
            {collapseAccountControls ? (
              <Button
                disabled={unavailable || pending}
                onClick={() =>
                  void perform('sign-in', {
                    profileId: status.activeProfileId ?? undefined,
                  })
                }
              >
                Sign in again
              </Button>
            ) : null}
            <Button
              disabled={unavailable || pending}
              onClick={() => void perform('sign-in', { newProfile: true })}
            >
              Add account
            </Button>
            <Button
              disabled={unavailable || pending}
              onClick={() => void perform('disconnect')}
            >
              Disconnect
            </Button>
            <Button
              disabled={unavailable}
              onClick={() => openExternal('https://chatgpt.com/settings/usage')}
            >
              Manage usage
            </Button>
          </div>
        </SettingRow>
      ) : null}
    </>
  );
  const connectionError = error || catalogError || status?.error;
  return (
    <>
      <SettingRow
        {...rowProps}
        name="ChatGPT account"
        desc={
          pending
            ? 'Complete sign-in in your browser.'
            : status?.connected
              ? status.planEnabled
                ? 'ChatGPT plan connected. Subscription limits apply.'
                : 'Connected. Plan access is not enabled for this account.'
              : collapseAccountControls
                ? 'Sign in with an eligible ChatGPT plan.'
                : 'Sign in to use eligible ChatGPT plan access. API keys are configured separately under OpenAI.'
        }
      >
        {pending ? (
          <Button disabled={unavailable} onClick={() => void perform('cancel')}>
            Cancel sign-in
          </Button>
        ) : (!collapseAccountControls && !compact) || !status?.connected ? (
          <Button
            disabled={unavailable}
            onClick={() =>
              void perform('sign-in', {
                profileId: status?.activeProfileId ?? undefined,
              })
            }
          >
            Continue with ChatGPT
          </Button>
        ) : (
          <span
            aria-hidden="true"
            className={clsx(styles.status, {
              [styles.mutedStatus]: !status.planEnabled,
            })}
          >
            {(!manageOpen &&
              !compact &&
              (activeProfile?.email || activeProfile?.name)) ||
              (status.planEnabled ? 'Plan active' : 'No plan')}
          </span>
        )}
      </SettingRow>
      {showModelSettings ? (
        <SettingRow
          {...rowProps}
          name="Model"
          desc={
            !status?.connected
              ? 'Sign in to see available models.'
              : !status.planEnabled
                ? 'This account has no ChatGPT plan access.'
                : catalogBusy
                  ? 'Loading models for this account…'
                  : !models.length
                    ? 'Models are unavailable. Refresh models to try again.'
                    : undefined
          }
        >
          <Menu
            items={models.map(item => (
              <MenuItem key={item.id} onSelect={() => onModelChange(item.id)}>
                {item.name}
              </MenuItem>
            ))}
          >
            <MenuTrigger
              className={styles.menuTrigger}
              disabled={unavailable || pending || !models.length}
              aria-label="ChatGPT models"
            >
              {models.find(item => item.id === model)?.name ||
                (catalogBusy ? 'Loading models…' : 'Choose model')}
            </MenuTrigger>
          </Menu>
        </SettingRow>
      ) : null}
      {collapseAccountControls ? (
        status?.connected || status?.profiles.length ? (
          <details
            className={styles.disclosure}
            open={manageOpen}
            onToggle={event => setManageOpen(event.currentTarget.open)}
          >
            <summary className={styles.disclosureSummary}>
              Manage account
            </summary>
            {manageOpen ? (
              <div className={styles.disclosureContent}>{accountControls}</div>
            ) : null}
          </details>
        ) : null
      ) : (
        accountControls
      )}
      {status?.connected && (showCatalogRefresh || connectionError) ? (
        <SettingRow {...rowProps} name="Model catalog">
          <Button
            disabled={
              unavailable || pending || catalogBusy || !status.planEnabled
            }
            onClick={() => void refreshCatalog()}
          >
            {catalogBusy ? 'Loading models…' : 'Refresh models'}
          </Button>
        </SettingRow>
      ) : null}
      {connectionError ? (
        <div className={styles.error} role="alert">
          {connectionError}
        </div>
      ) : null}
    </>
  );
}
