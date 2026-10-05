import type { Workspace } from '@blocksuite/affine/store';
import { Button } from '@nota/component';
import { useMemo, useRef, useState } from 'react';

import {
  type CsvColumnType,
  type CsvDelimiter,
  type CsvMapping,
  decodeCsv,
  parseCsv,
  suggestCsvMapping,
  validateCsvMapping,
} from './csv';
import {
  type CsvImportJob,
  prepareCsvImport,
  publishCsvImport,
} from './csv-import';
import * as style from './styles.css';

const columnTypes: { type: CsvColumnType; name: string }[] = [
  { type: 'title', name: 'Title' },
  { type: 'rich-text', name: 'Text' },
  { type: 'number', name: 'Number' },
  { type: 'checkbox', name: 'Checkbox' },
  { type: 'date', name: 'Date (YYYY-MM-DD)' },
  { type: 'select', name: 'Select' },
  { type: 'link', name: 'Link' },
  { type: 'skip', name: 'Skip' },
];

export function CsvImportPreview({
  bytes,
  fileName,
  workspace,
  onCancel,
  onImported,
}: {
  bytes: Uint8Array;
  fileName: string;
  workspace: Workspace;
  onCancel: () => void;
  onImported: (job: CsvImportJob) => void;
}) {
  const [settings, setSettings] = useState<{
    delimiter: CsvDelimiter;
    header: boolean;
    encoding: string;
  }>({
    delimiter: fileName.toLowerCase().endsWith('.tsv') ? '\t' : ',',
    header: true,
    encoding: 'utf-8',
  });
  const parsed = useMemo(() => {
    try {
      return {
        preview: parseCsv(
          decodeCsv(bytes, settings.encoding),
          settings.delimiter,
          settings.header
        ),
        error: null,
      };
    } catch (error) {
      return { preview: null, error: (error as Error).message };
    }
  }, [bytes, settings]);
  const [mappingOverride, setMappingOverride] = useState<CsvMapping[] | null>(
    null
  );
  const mapping = useMemo(
    () =>
      mappingOverride ??
      (parsed.preview ? suggestCsvMapping(parsed.preview) : []),
    [mappingOverride, parsed.preview]
  );
  const [title, setTitle] = useState(
    fileName.replace(/\.(csv|tsv)$/i, '') || 'Imported database'
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const jobRef = useRef<CsvImportJob | null>(null);
  const errors = useMemo(
    () => (parsed.preview ? validateCsvMapping(parsed.preview, mapping) : []),
    [parsed.preview, mapping]
  );
  const changeSettings = (next: typeof settings) => {
    setSettings(next);
    setMappingOverride(null);
    setImportError(null);
    jobRef.current = null;
  };
  const changeColumn = (index: number, change: Partial<CsvMapping>) => {
    setMappingOverride(
      mapping.map((column, i) =>
        i === index ? { ...column, ...change } : column
      )
    );
    jobRef.current = null;
    setImportError(null);
  };
  const importDatabase = () => {
    if (!parsed.preview || errors.length || importing) return;
    setImporting(true);
    try {
      const job =
        jobRef.current ??
        prepareCsvImport(
          workspace,
          parsed.preview,
          mapping,
          title.trim() || 'Imported database'
        );
      jobRef.current = job;
      publishCsvImport(workspace, job);
      onImported(job);
    } catch (error) {
      setImportError((error as Error).message);
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <div className={style.importModalTitle}>Import database from CSV</div>
      <div className={style.csvControls}>
        <label>
          Database name
          <input
            aria-label="Database name"
            value={title}
            onChange={event => {
              setTitle(event.target.value);
              jobRef.current = null;
            }}
          />
        </label>
        <label>
          Separator
          <select
            aria-label="Separator"
            value={settings.delimiter}
            onChange={event =>
              changeSettings({
                ...settings,
                delimiter: event.target.value as CsvDelimiter,
              })
            }
          >
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value={'\t'}>Tab</option>
          </select>
        </label>
        <label>
          Encoding
          <select
            aria-label="Encoding"
            value={settings.encoding}
            onChange={event =>
              changeSettings({ ...settings, encoding: event.target.value })
            }
          >
            <option value="utf-8">UTF-8</option>
            <option value="windows-1252">Windows-1252</option>
            <option value="utf-16le">UTF-16</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.header}
            onChange={event =>
              changeSettings({ ...settings, header: event.target.checked })
            }
          />
          First row contains column names
        </label>
      </div>
      {parsed.preview && (
        <>
          <p className={style.importModalTip}>
            {parsed.preview.rows.length} rows, {mapping.length} columns. Preview
            shows the first 5 rows. Choose one Title column; other columns can
            be renamed or skipped.
          </p>
          <div className={style.csvTableContainer}>
            <table className={style.csvTable}>
              <thead>
                <tr>
                  {mapping.map((column, i) => (
                    <th key={i} className={style.csvCell}>
                      <input
                        aria-label={`Column ${i + 1} name`}
                        value={column.name}
                        onChange={event =>
                          changeColumn(i, { name: event.target.value })
                        }
                      />
                      <select
                        aria-label={`Column ${i + 1} type`}
                        value={column.type}
                        onChange={event =>
                          changeColumn(i, {
                            type: event.target.value as CsvColumnType,
                          })
                        }
                      >
                        {columnTypes.map(option => (
                          <option key={option.type} value={option.type}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.preview.rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j} className={style.csvCell}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.preview.warnings.map(warning => (
            <p className={style.importModalTip} key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}
      <p className={style.importModalTip}>
        CSV imports cell values. Relations, formulas, views, and attached files
        need a Nota snapshot to preserve their full behavior. Date values use
        YYYY-MM-DD; keep other formats as Text.
      </p>
      {(parsed.error || importError || errors.length > 0) && (
        <div role="alert" className={style.csvError}>
          {parsed.error || importError || errors.join('\n')}
        </div>
      )}
      <div className={style.importModalButtonContainer}>
        <Button onClick={onCancel} disabled={importing}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={!parsed.preview || errors.length > 0 || importing}
          onClick={importDatabase}
        >
          {importing
            ? 'Importing…'
            : importError
              ? 'Retry import'
              : 'Import database'}
        </Button>
      </div>
    </>
  );
}
