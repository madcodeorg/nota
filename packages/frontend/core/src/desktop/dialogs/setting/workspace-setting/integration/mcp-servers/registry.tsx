import { Button, Input, Menu, MenuItem } from '@nota/component';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  IntegrationCard,
  IntegrationCardContent,
  IntegrationCardFooter,
  IntegrationCardHeader,
} from '../card';
import { list } from '../index.css';
import MCPIcon from '../mcp-server/MCP.inline.svg';
import {
  draftFromRegistry,
  installLabel,
  installTag,
  mcpApi,
  type McpServerDraft,
  type RegistryEntry,
  sortedInstalls,
} from './api';
import { draftFromFeatured, FEATURED_MCP_SERVERS } from './featured';
import * as styles from './setting-panel.css';

const httpsIcon = (icon?: string) => {
  try {
    return icon && new URL(icon).protocol === 'https:' ? icon : MCPIcon;
  } catch {
    return MCPIcon;
  }
};

const RegistryResult = ({
  entry,
  disabled,
  onAdd,
}: {
  entry: RegistryEntry;
  disabled: boolean;
  onAdd: (draft: McpServerDraft) => void;
}) => {
  const installs = sortedInstalls(entry);
  const tags = [...new Set(installs.map(installTag))];
  const title = entry.title || entry.name;
  return (
    <li className={styles.serverRow}>
      <img
        className={styles.serverIcon}
        src={httpsIcon(entry.icon)}
        alt=""
        referrerPolicy="no-referrer"
      />
      <div className={styles.serverInfo}>
        <div className={styles.serverTitle}>
          <span className={styles.serverName}>{title}</span>
          {tags.map(tag => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className={styles.serverDesc}>{entry.description}</div>
      </div>
      {installs.length > 1 ? (
        <Menu
          items={installs.map((install, index) => (
            <MenuItem
              key={index}
              onSelect={() => onAdd(draftFromRegistry(entry, install))}
            >
              {installLabel(install)}
            </MenuItem>
          ))}
        >
          <Button disabled={disabled} aria-label={`Add ${title}`}>
            Add
          </Button>
        </Menu>
      ) : (
        <Button
          disabled={disabled || !installs.length}
          aria-label={`Add ${title}`}
          onClick={() => onAdd(draftFromRegistry(entry, installs[0]))}
        >
          Add
        </Button>
      )}
    </li>
  );
};

export const McpRegistryBrowser = ({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (draft: McpServerDraft) => void;
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegistryEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const search = useCallback(async (text: string, nextCursor?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await mcpApi.searchRegistry(
        text,
        nextCursor,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setResults(current =>
        nextCursor ? [...current, ...page.servers] : page.servers
      );
      setCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted)
        setError("Couldn't reach the MCP Registry.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      requestRef.current?.abort();
      setResults([]);
      setCursor(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void search(text), 400);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => () => requestRef.current?.abort(), []);

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Featured</h2>
        <ul className={list}>
          {FEATURED_MCP_SERVERS.map(item => (
            <li key={item.name}>
              <IntegrationCard
                className={styles.featuredCard}
                onClick={() => {
                  if (!disabled) onAdd(draftFromFeatured(item));
                }}
              >
                <IntegrationCardHeader
                  icon={<img src={MCPIcon} alt="" />}
                  title={item.name}
                />
                <IntegrationCardContent desc={item.description} />
                <IntegrationCardFooter>
                  <span className={styles.tag}>
                    {'url' in item ? 'Remote' : 'Local'}
                  </span>
                  <Button
                    size="default"
                    disabled={disabled}
                    aria-label={`Add ${item.name}`}
                    onClick={event => {
                      event.stopPropagation();
                      onAdd(draftFromFeatured(item));
                    }}
                  >
                    Add
                  </Button>
                </IntegrationCardFooter>
              </IntegrationCard>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Search the MCP Registry</h2>
        <Input
          value={query}
          placeholder="Search servers"
          aria-label="Search the MCP Registry"
          onChange={setQuery}
        />
        <p className={styles.notice}>
          From the official MCP Registry. Listings are not reviewed — check the
          publisher before adding.
        </p>
        {error ? (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        ) : null}
        {query.trim() && !loading && !error && !results.length ? (
          <p className={styles.notice}>No servers found.</p>
        ) : null}
        {results.length ? (
          <ul className={styles.serverList}>
            {results.map(entry => (
              <RegistryResult
                key={`${entry.name}@${entry.version}`}
                entry={entry}
                disabled={disabled}
                onAdd={onAdd}
              />
            ))}
          </ul>
        ) : null}
        {loading ? <p className={styles.notice}>Searching…</p> : null}
        {cursor && !loading ? (
          <div>
            <Button onClick={() => void search(query.trim(), cursor)}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
};
