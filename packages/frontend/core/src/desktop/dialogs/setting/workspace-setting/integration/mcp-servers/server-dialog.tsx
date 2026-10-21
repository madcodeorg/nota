import { CloseIcon, PlusIcon, WarningIcon } from '@blocksuite/icons/rc';
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RadioGroup,
} from '@nota/component';
import { type ReactNode, useRef, useState } from 'react';

import {
  draftToInput,
  MAX_ICON_BYTES,
  mcpApi,
  type McpAuthType,
  type McpRow,
  type McpServerDraft,
  type McpServerView,
  transportLabel,
  validateDraft,
} from './api';
import * as styles from './server-dialog.css';

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'API key (Bearer token)' },
  { value: 'header', label: 'Custom header' },
  { value: 'oauth', label: 'OAuth' },
];

const SAVED_PLACEHOLDER = 'Saved — leave blank to keep';

const Field = ({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) => (
  <div className={styles.field}>
    <div className={styles.label}>{label}</div>
    {children}
    {error ? (
      <div className={styles.error} role="alert">
        {error}
      </div>
    ) : hint ? (
      <div className={styles.hint}>{hint}</div>
    ) : null}
  </div>
);

const RowsEditor = ({
  label,
  kind,
  rows,
  onChange,
}: {
  label: string;
  kind: string;
  rows: McpRow[];
  onChange: (rows: McpRow[]) => void;
}) => {
  const update = (index: number, patch: Partial<McpRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className={styles.field}>
      <div className={styles.label}>{label}</div>
      {rows.map((row, index) => (
        <div key={index} className={styles.rowGroup}>
          <div className={styles.row}>
            <Input
              className={styles.rowInput}
              value={row.name}
              placeholder="Name"
              aria-label={`${kind} name`}
              onChange={name => update(index, { name })}
            />
            <Input
              className={styles.rowInput}
              type="password"
              value={row.value}
              placeholder={
                row.hasValue
                  ? SAVED_PLACEHOLDER
                  : row.optional
                    ? 'Value (optional)'
                    : 'Value'
              }
              aria-label={`${kind} value`}
              onChange={value => update(index, { value })}
            />
            <IconButton
              aria-label={`Remove ${kind}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <CloseIcon />
            </IconButton>
          </div>
          {row.description ? (
            <div className={styles.hint}>{row.description}</div>
          ) : null}
        </div>
      ))}
      <div>
        <Button
          variant="plain"
          prefix={<PlusIcon />}
          onClick={() => onChange([...rows, { name: '', value: '' }])}
        >
          Add {kind}
        </Button>
      </div>
    </div>
  );
};

export const McpServerDialog = ({
  initial,
  existingNames,
  onClose,
  onSaved,
}: {
  initial: McpServerDraft;
  existingNames: string[];
  onClose: () => void;
  onSaved: (server: McpServerView) => void;
}) => {
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = !!initial.originalName;

  const update = (patch: Partial<McpServerDraft>) => {
    setDraft(current => ({ ...current, ...patch }));
    setDirty(true);
  };

  const problems = validateDraft(draft, existingNames);
  const canSubmit = understood && !problems.name && !problems.form && !saving;
  const showNameError = !!draft.name.trim() || draft.name !== initial.name;
  const formHint = problems.form ?? (showNameError ? undefined : problems.name);

  const onIconFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'image/png') {
      setIconError('Choose a PNG image.');
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setIconError('The icon must be 10 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      setIconError(null);
      update({ icon: reader.result });
    };
    reader.onerror = () => setIconError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { server } = await mcpApi.save(draftToInput(draft));
      onSaved(server);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  const authLabel =
    AUTH_OPTIONS.find(option => option.value === draft.authType)?.label ??
    'None';

  return (
    <Modal
      open
      width={560}
      title={editing ? 'Edit MCP server' : 'Add custom MCP server'}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <div className={styles.body}>
        <Field
          label="Icon (optional)"
          hint="PNG only. Best results at 256 × 256 px or larger. Max file size: 10 KB"
          error={iconError ?? undefined}
        >
          <div className={styles.iconRow}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={draft.icon ? 'Change icon' : 'Choose icon'}
              onClick={() => fileRef.current?.click()}
            >
              {draft.icon ? (
                <img className={styles.iconPreview} src={draft.icon} alt="" />
              ) : (
                <PlusIcon />
              )}
            </button>
            {draft.icon ? (
              <Button variant="plain" onClick={() => update({ icon: '' })}>
                Remove icon
              </Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              className={styles.fileInput}
              aria-label="Upload icon"
              onChange={event => {
                onIconFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </div>
        </Field>

        <Field label="Name" error={showNameError ? problems.name : undefined}>
          <Input
            value={draft.name}
            placeholder="Custom Tool"
            aria-label="Name"
            maxLength={64}
            onChange={name => update({ name })}
          />
        </Field>

        <Field label="Description (optional)">
          <Input
            value={draft.description}
            placeholder="Explain what it does in a few words"
            aria-label="Description"
            onChange={description => update({ description })}
          />
        </Field>

        <Field label="Connection">
          <RadioGroup
            width="100%"
            value={draft.mode}
            onChange={(mode: McpServerDraft['mode']) => update({ mode })}
            items={[
              { value: 'remote', label: 'Server URL' },
              { value: 'stdio', label: 'Local command' },
            ]}
          />
        </Field>

        {draft.mode === 'remote' ? (
          <>
            <Field label="Server URL">
              <Input
                value={draft.url}
                placeholder="https://example.com/mcp"
                aria-label="Server URL"
                onChange={url => update({ url })}
              />
            </Field>
            <Field label="Transport">
              <Menu
                items={(['http', 'sse'] as const).map(transport => (
                  <MenuItem
                    key={transport}
                    selected={draft.transport === transport}
                    onSelect={() => update({ transport })}
                  >
                    {transportLabel(transport)}
                  </MenuItem>
                ))}
              >
                <MenuTrigger
                  className={styles.menuTrigger}
                  aria-label="Transport"
                >
                  {transportLabel(draft.transport)}
                </MenuTrigger>
              </Menu>
            </Field>
            <RowsEditor
              label="Extra headers (optional)"
              kind="header"
              rows={draft.headers}
              onChange={headers => update({ headers })}
            />
          </>
        ) : (
          <>
            <Field label="Command">
              <Input
                value={draft.command}
                placeholder="npx"
                aria-label="Command"
                onChange={command => update({ command })}
              />
            </Field>
            <Field label="Arguments" hint="One argument per line.">
              <textarea
                className={styles.textarea}
                value={draft.args}
                placeholder={'-y\n@scope/server-name'}
                aria-label="Arguments"
                spellCheck={false}
                onChange={event => update({ args: event.currentTarget.value })}
              />
            </Field>
            <RowsEditor
              label="Environment variables (optional)"
              kind="variable"
              rows={draft.env}
              onChange={env => update({ env })}
            />
          </>
        )}

        <Field label="Authentication">
          {draft.mode === 'stdio' ? (
            <div className={styles.hint}>
              Local commands use environment variables for credentials.
            </div>
          ) : (
            <Menu
              items={AUTH_OPTIONS.map(option => (
                <MenuItem
                  key={option.value}
                  selected={draft.authType === option.value}
                  onSelect={() => update({ authType: option.value })}
                >
                  {option.label}
                </MenuItem>
              ))}
            >
              <MenuTrigger
                className={styles.menuTrigger}
                aria-label="Authentication"
              >
                {authLabel}
              </MenuTrigger>
            </Menu>
          )}
        </Field>

        {draft.mode === 'remote' && draft.authType === 'bearer' ? (
          <Field label="API key">
            <Input
              type="password"
              value={draft.token}
              placeholder={draft.hasToken ? SAVED_PLACEHOLDER : 'Token'}
              aria-label="API key"
              onChange={token => update({ token })}
            />
          </Field>
        ) : null}

        {draft.mode === 'remote' && draft.authType === 'header' ? (
          <>
            <Field label="Header name">
              <Input
                value={draft.headerName}
                placeholder="X-API-Key"
                aria-label="Header name"
                onChange={headerName => update({ headerName })}
              />
            </Field>
            <Field label="Header value">
              <Input
                type="password"
                value={draft.headerValue}
                placeholder={draft.hasHeaderValue ? SAVED_PLACEHOLDER : 'Value'}
                aria-label="Header value"
                onChange={headerValue => update({ headerValue })}
              />
            </Field>
          </>
        ) : null}

        {draft.mode === 'remote' && draft.authType === 'oauth' ? (
          <details className={styles.disclosure}>
            <summary className={styles.disclosureSummary}>
              Advanced OAuth settings
            </summary>
            <div className={styles.disclosureContent}>
              <div className={styles.hint}>
                Leave empty to let Nota register automatically.
              </div>
              <Field label="Client ID">
                <Input
                  value={draft.clientId}
                  aria-label="Client ID"
                  onChange={clientId => update({ clientId })}
                />
              </Field>
              <Field label="Client secret">
                <Input
                  type="password"
                  value={draft.clientSecret}
                  placeholder={
                    draft.hasClientSecret ? SAVED_PLACEHOLDER : undefined
                  }
                  aria-label="Client secret"
                  onChange={clientSecret => update({ clientSecret })}
                />
              </Field>
              <Field label="Scopes">
                <Input
                  value={draft.scopes}
                  placeholder="read write"
                  aria-label="Scopes"
                  onChange={scopes => update({ scopes })}
                />
              </Field>
            </div>
          </details>
        ) : null}

        <div className={styles.warning}>
          <WarningIcon className={styles.warningIcon} />
          <div>
            <div className={styles.warningTitle}>
              Custom MCP servers introduce risk.
            </div>
            <p className={styles.warningText}>
              Only connect to MCP servers you trust. An untrusted server may
              access or steal information shared through Nota AI, or trick it
              into using tools in unintended ways, including changing or
              deleting data. Nota asks before running tools that write.
            </p>
            <Checkbox
              className={styles.understand}
              name="mcp-server-understand"
              label="I understand and want to continue"
              checked={understood}
              onChange={(_, checked) => setUnderstood(checked)}
            />
          </div>
        </div>

        {dirty && formHint ? (
          <div className={styles.hint}>{formHint}</div>
        ) : null}
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <div className={styles.footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!canSubmit}
          loading={saving}
          onClick={() => void submit()}
        >
          {editing ? 'Save changes' : 'Add server'}
        </Button>
      </div>
    </Modal>
  );
};
