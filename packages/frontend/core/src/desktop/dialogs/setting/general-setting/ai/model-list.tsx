import { DownloadIcon, ResetIcon } from '@blocksuite/icons/rc';
import { Button, Progress } from '@nota/component';

import {
  canDownloadLocalModel,
  localModelStatusLabel,
  type LocalTextModelSelectionInput,
  localTextModelSelectionState,
} from './local-model-selection';
import * as styles from './model-list.css';

export type LocalModelInfo = LocalTextModelSelectionInput & {
  id: string;
  type: 'text' | 'embedding' | 'stt';
  runtime: string;
  sizeMb: number;
  minRamGb: number;
  contextWindowTokens?: number;
  usageGuidance?: string;
  tier?: 'small' | 'medium' | 'large';
  runtimeProbe?: NonNullable<LocalTextModelSelectionInput['runtimeProbe']> & {
    checkedAt?: string;
    modelId?: string;
    runtimeId?: string;
  };
  bytesDownloaded?: number;
  totalBytes?: number;
  localPath?: string;
  notes?: string;
};

export type LocalModelListProps = {
  models: LocalModelInfo[];
  selectedModelId: string | null;
  disabled: boolean;
  downloadingModelId: string | null;
  probingModelId: string | null;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onProbe: (id: string) => void;
};

const modelNames: Record<string, string> = {
  'gemma-4-e2b-it-onnx-q4f16': 'Gemma 4 E2B',
  'gemma-4-e4b-it-onnx-q4f16': 'Gemma 4 E4B',
  'qwen3.5-0.8b-onnx-q4f16': 'Qwen3.5 0.8B',
  'qwen3.5-2b-onnx-q4f16': 'Qwen3.5 2B',
  'qwen3.5-4b-onnx-q4f16': 'Qwen3.5 4B',
  'lfm2.5-230m-onnx-q4': 'LFM2.5 230M',
  'lfm2.5-350m-onnx-q4f16': 'LFM2.5 350M',
  'lfm2.5-1.2b-instruct-onnx-q4f16': 'LFM2.5 1.2B Instruct',
  'lfm2.5-2.6b-onnx-q4f16': 'LFM2.5 2.6B',
  'smollm3-3b-onnx-q4f16': 'SmolLM3 3B',
  'all-minilm-l6-v2-embedding': 'MiniLM L6 Embeddings',
};

export function localModelName(modelId: string) {
  return modelNames[modelId] ?? modelId;
}

function downloadBytesLabel(model: LocalModelInfo) {
  const downloaded = model.bytesDownloaded;
  const total = model.totalBytes;
  if (
    typeof downloaded !== 'number' ||
    !Number.isFinite(downloaded) ||
    downloaded < 0
  ) {
    return null;
  }
  const hasTotal =
    typeof total === 'number' && Number.isFinite(total) && total > 0;
  const downloadedMb = Math.round(
    (hasTotal ? Math.min(downloaded, total) : downloaded) / 1024 / 1024
  ).toLocaleString();
  return hasTotal
    ? `${downloadedMb} / ${Math.round(total / 1024 / 1024).toLocaleString()} MB`
    : `${downloadedMb} MB`;
}

export function LocalModelList({
  models,
  selectedModelId,
  disabled,
  downloadingModelId,
  probingModelId,
  onSelect,
  onDownload,
  onProbe,
}: LocalModelListProps) {
  if (models.length === 0) {
    return (
      <div className={styles.status} role="status">
        No local models reported.
      </div>
    );
  }

  return (
    <ul className={styles.list} aria-label="Local models">
      {models.map(model => {
        const name = localModelName(model.id);
        const selected = selectedModelId === model.id;
        const selection = localTextModelSelectionState(model);
        const probe = model.runtimeProbe;
        const installed =
          model.downloadStatus === 'downloaded' &&
          probe?.status !== 'missing_model';
        const downloading =
          downloadingModelId === model.id ||
          model.downloadStatus === 'queued' ||
          model.downloadStatus === 'downloading';
        const probing = probingModelId === model.id;
        const busy = disabled || downloading || probing;
        const probeFailed =
          probe &&
          (probe.status !== 'available' ||
            !probe.runtimeAvailable ||
            !probe.canLoad);
        const reason =
          (probeFailed && probe.message) ||
          (model.deviceFit !== 'fits' && model.deviceFitReason) ||
          selection.reason;
        const progress =
          typeof model.progress === 'number' && Number.isFinite(model.progress)
            ? Math.round(Math.min(1, Math.max(0, model.progress)) * 100)
            : 0;
        const bytesLabel = downloadBytesLabel(model);

        return (
          <li className={styles.row} key={model.id} aria-label={name}>
            <div className={styles.main}>
              <div className={styles.info}>
                <div className={styles.heading}>
                  <span className={styles.name}>{name}</span>
                  {selected ? (
                    <span className={styles.selected}>Selected</span>
                  ) : null}
                </div>
                <div className={styles.facts}>
                  <span>{model.sizeMb.toLocaleString()} MB</span>
                  <span>Min. {model.minRamGb} GB RAM</span>
                  {model.contextWindowTokens ? (
                    <span>
                      {model.contextWindowTokens.toLocaleString()} token context
                    </span>
                  ) : null}
                  {model.tier ? (
                    <span className={styles.tier}>{model.tier}</span>
                  ) : null}
                </div>
                <div className={styles.status} aria-live="polite">
                  {probing
                    ? 'Checking model'
                    : localModelStatusLabel(model, false)}
                </div>
                {model.usageGuidance ? (
                  <div className={styles.status}>{model.usageGuidance}</div>
                ) : null}
              </div>
              <div className={styles.actions}>
                {installed && selection.selectable ? (
                  <Button
                    className={styles.action}
                    contentClassName={styles.actionContent}
                    disabled={busy || selected}
                    aria-pressed={selected}
                    onClick={() => onSelect(model.id)}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </Button>
                ) : null}
                {canDownloadLocalModel(model) ? (
                  <Button
                    className={styles.action}
                    contentClassName={styles.actionContent}
                    disabled={busy}
                    loading={downloadingModelId === model.id}
                    prefix={<DownloadIcon />}
                    onClick={() => onDownload(model.id)}
                  >
                    Download
                  </Button>
                ) : null}
                {model.downloadStatus === 'downloaded' ? (
                  <Button
                    className={styles.action}
                    contentClassName={styles.actionContent}
                    variant="plain"
                    disabled={busy || probingModelId !== null}
                    loading={probing}
                    prefix={<ResetIcon />}
                    tooltip="Loads the model into memory to check its runtime."
                    onClick={() => onProbe(model.id)}
                  >
                    Check model
                  </Button>
                ) : null}
              </div>
            </div>
            {reason ? <div className={styles.reason}>{reason}</div> : null}
            {downloading ? (
              <div
                className={styles.download}
                role="group"
                aria-label={`${name} download progress`}
              >
                <Progress readonly value={progress} />
                {bytesLabel ? (
                  <span className={styles.status}>{bytesLabel}</span>
                ) : null}
              </div>
            ) : null}
            <details className={styles.details}>
              <summary className={styles.summary}>Technical details</summary>
              <dl className={styles.detailList}>
                <div className={styles.detailRow}>
                  <dt>ID</dt>
                  <dd className={styles.detailValue}>{model.id}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Path</dt>
                  <dd className={styles.detailValue}>
                    {model.localPath ||
                      (installed ? 'Not reported' : 'Not installed')}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Runtime</dt>
                  <dd className={styles.detailValue}>{model.runtime}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Last probe</dt>
                  <dd className={styles.detailValue}>
                    {probe ? (
                      <>
                        {probe.checkedAt ? (
                          <time dateTime={probe.checkedAt}>
                            {probe.checkedAt}
                          </time>
                        ) : null}
                        <div>
                          {probe.status.replace(/_/g, ' ')}
                          {probe.message ? `: ${probe.message}` : ''}
                        </div>
                      </>
                    ) : (
                      'Not checked'
                    )}
                  </dd>
                </div>
                {model.notes ? (
                  <div className={styles.detailRow}>
                    <dt>Notes</dt>
                    <dd className={styles.detailValue}>{model.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
