import {
  Button,
  ErrorMessage,
  notify,
  Skeleton,
  Switch,
  useConfirmModal,
} from '@nota/component';
import { UrlService } from '@nota/core/modules/url';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';

import MCPIcon from '../mcp-server/MCP.inline.svg';
import { IntegrationSettingHeader, IntegrationSettingItem } from '../setting';
import {
  connectionSummary,
  draftFromServer,
  draftToInput,
  emptyDraft,
  mcpApi,
  type McpServerDraft,
  type McpServersResponse,
  type McpServerView,
  validatedOAuthUrl,
} from './api';
import { McpRegistryBrowser } from './registry';
import { McpServerDialog } from './server-dialog';
import * as styles from './setting-panel.css';

const OAUTH_POLL_MS = 2000;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

const STATUS_LABELS: Record<McpServerView['status']['state'], string> = {
  ready: 'Ready',
  gated: 'Gated',
  error: 'Error',
  'auth-required': 'Sign-in required',
  disabled: 'Off',
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

function statusDetail(status: McpServerView['status']) {
  if (status.state === 'error') return status.error;
  if (status.state === 'gated') {
    const count = status.blockedToolNames.length;
    return `${plural(count, 'write tool')} ${count === 1 ? 'needs' : 'need'} approval`;
  }
  if (status.state === 'ready')
    return `${plural(status.toolNames.length, 'tool')} available`;
  return undefined;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

const isConnected = (server?: McpServerView) =>
  server?.auth.type === 'oauth' && server.auth.connected;

export const McpServersSettingPanel = () => {
  const t = useI18n();
  const urlService = useService(UrlService);
  const { openConfirmModal } = useConfirmModal();
  const [data, setData] = useState<McpServersResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<McpServerDraft | null>(null);
  const requestRef = useRef(0);
  const oauthRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const next = await mcpApi.list();
      if (request !== requestRef.current) return;
      setData(next);
      setLoadError(null);
    } catch (error) {
      if (request !== requestRef.current) return;
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => () => oauthRef.current?.abort(), []);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await action();
        await load();
      } catch (error) {
        notify.error({ title: errorMessage(error) });
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const connect = useCallback(
    async (name: string) => {
      oauthRef.current?.abort();
      const controller = new AbortController();
      oauthRef.current = controller;
      setConnecting(name);
      try {
        const { url } = await mcpApi.startOAuth(name);
        urlService.openExternal(validatedOAuthUrl(url));
        const deadline = Date.now() + OAUTH_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await wait(OAUTH_POLL_MS, controller.signal);
          const next = await mcpApi.list(controller.signal);
          requestRef.current++;
          setData(next);
          if (isConnected(next.servers.find(server => server.name === name))) {
            notify.success({ title: `Connected to ${name}` });
            return;
          }
        }
        notify.error({ title: 'Sign-in timed out. Try connecting again.' });
      } catch (error) {
        if (!controller.signal.aborted)
          notify.error({ title: errorMessage(error) });
      } finally {
        if (oauthRef.current === controller) {
          oauthRef.current = null;
          setConnecting(null);
        }
      }
    },
    [urlService]
  );

  const cancelConnect = useCallback(() => {
    oauthRef.current?.abort();
    oauthRef.current = null;
    setConnecting(null);
  }, []);

  const onSaved = useCallback(
    (server: McpServerView) => {
      setDialog(null);
      load().catch(console.error);
      if (server.auth.type === 'oauth' && !server.auth.connected) {
        connect(server.name).catch(console.error);
      }
    },
    [connect, load]
  );

  const confirmRemove = useCallback(
    (server: McpServerView) => {
      openConfirmModal({
        title: `Remove ${server.name}?`,
        description:
          'Nota will stop using this server and delete its saved credentials.',
        confirmText: 'Remove',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: () => run(server.name, () => mcpApi.remove(server.name)),
      });
    },
    [openConfirmModal, run]
  );

  const header = (
    <IntegrationSettingHeader
      icon={<img src={MCPIcon} />}
      name={t['com.affine.integration.mcp-servers.name']()}
      desc={t['com.affine.integration.mcp-servers.desc']()}
    />
  );

  if (!data) {
    return (
      <div>
        {header}
        {loadError ? <ErrorMessage>{loadError}</ErrorMessage> : <Skeleton />}
      </div>
    );
  }

  const locked = !data.toolsEnabled;
  const servers = data.servers;

  return (
    <div className={styles.panel}>
      {header}
      {locked ? (
        <p className={styles.notice}>
          Turn on AI tools in Settings → AI to use MCP servers.
        </p>
      ) : null}
      {data.error ? <ErrorMessage>{data.error}</ErrorMessage> : null}
      <IntegrationSettingItem name="Enable MCP servers">
        <Switch
          checked={data.enabled}
          aria-label="Enable MCP servers"
          disabled={locked || busy === 'master'}
          onChange={enabled =>
            void run('master', () => mcpApi.setEnabled(enabled))
          }
        />
      </IntegrationSettingItem>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Your servers</h2>
          <Button
            variant="primary"
            disabled={locked}
            onClick={() => setDialog(emptyDraft())}
          >
            Add server
          </Button>
        </div>
        {servers.length ? (
          <ul className={styles.serverList}>
            {servers.map(server => {
              const detail = statusDetail(server.status);
              const rowBusy = locked || busy === server.name;
              const oauth = server.auth.type === 'oauth' ? server.auth : null;
              return (
                <li key={server.name} className={styles.serverRow}>
                  <img
                    className={styles.serverIcon}
                    src={server.icon || MCPIcon}
                    alt=""
                  />
                  <div className={styles.serverInfo}>
                    <div className={styles.serverTitle}>
                      <span className={styles.serverName}>{server.name}</span>
                      <span
                        className={clsx(
                          styles.pill,
                          styles.pillState[server.status.state]
                        )}
                      >
                        {STATUS_LABELS[server.status.state]}
                      </span>
                    </div>
                    <div className={styles.serverDesc}>
                      {server.description ||
                        connectionSummary(server.connection)}
                    </div>
                    {detail ? (
                      <div
                        className={clsx(styles.serverDesc, {
                          [styles.errorText]: server.status.state === 'error',
                        })}
                      >
                        {detail}
                      </div>
                    ) : null}
                    <div className={styles.serverActions}>
                      {oauth && connecting === server.name ? (
                        <Button variant="plain" onClick={cancelConnect}>
                          Cancel sign-in
                        </Button>
                      ) : oauth ? (
                        <Button
                          variant="plain"
                          disabled={rowBusy || !!connecting}
                          onClick={() => void connect(server.name)}
                        >
                          {oauth.connected ? 'Reconnect' : 'Connect'}
                        </Button>
                      ) : null}
                      {oauth?.connected && connecting !== server.name ? (
                        <Button
                          variant="plain"
                          disabled={rowBusy}
                          onClick={() =>
                            void run(server.name, () =>
                              mcpApi.disconnectOAuth(server.name)
                            )
                          }
                        >
                          Disconnect
                        </Button>
                      ) : null}
                      <Button
                        variant="plain"
                        disabled={rowBusy}
                        onClick={() => setDialog(draftFromServer(server))}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="plain"
                        disabled={rowBusy}
                        onClick={() => confirmRemove(server)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <Switch
                    checked={server.enabled}
                    aria-label={`Enable ${server.name}`}
                    disabled={rowBusy}
                    onChange={enabled =>
                      void run(server.name, () =>
                        mcpApi.save({
                          ...draftToInput(draftFromServer(server)),
                          enabled,
                        })
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}>
            No servers yet. Add one, or pick a featured server below.
          </p>
        )}
      </section>

      <McpRegistryBrowser disabled={locked} onAdd={setDialog} />

      {dialog ? (
        <McpServerDialog
          initial={dialog}
          existingNames={servers.map(server => server.name)}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
};
