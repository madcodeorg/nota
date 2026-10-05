import { dsvFormat } from 'd3-dsv';

export type CsvColumnType =
  | 'title'
  | 'rich-text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'link'
  | 'skip';
export type CsvDelimiter = ',' | ';' | '\t';
export type CsvPreview = {
  headers: string[];
  rows: string[][];
  warnings: string[];
};
export type CsvMapping = { name: string; type: CsvColumnType };
export const CSV_MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 200;

// D3 handles escaping and positional cells. Validate incomplete quoted fields
// first because its intentionally forgiving parser would otherwise accept them.
function validateQuotes(source: string, delimiter: string) {
  let quoted = false;
  let fieldStart = true;
  let closed = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') i++;
        else {
          quoted = false;
          closed = true;
        }
      }
    } else if (char === delimiter || char === '\r' || char === '\n') {
      fieldStart = true;
      closed = false;
    } else if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else {
      if (closed || char === '"')
        throw new Error(
          'Invalid CSV quoting. Check the file or choose another separator.'
        );
      fieldStart = false;
    }
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.');
}

export function parseCsv(
  source: string,
  delimiter: CsvDelimiter = ',',
  hasHeader = true
): CsvPreview {
  const clean = source.replace(/^\uFEFF/, '');
  if (!clean.trim()) throw new Error('The CSV file is empty.');
  if (new TextEncoder().encode(clean).length > CSV_MAX_BYTES)
    throw new Error('CSV imports are limited to 20 MB.');
  validateQuotes(clean, delimiter);
  const parsed = dsvFormat(delimiter).parseRows(clean);
  if (parsed.length > MAX_ROWS + (hasHeader ? 1 : 0))
    throw new Error('CSV imports are limited to 10,000 rows.');
  const width = Math.max(...parsed.map(row => row.length));
  if (width > MAX_COLUMNS)
    throw new Error('CSV imports are limited to 200 columns.');
  const sourceHeaders = hasHeader ? (parsed.shift() ?? []) : [];
  const headers = Array.from(
    { length: width },
    (_, i) => sourceHeaders[i] || `Column ${i + 1}`
  );
  const warnings: string[] = [];
  if (new Set(headers).size !== headers.length)
    warnings.push('Duplicate column names are kept as separate columns.');
  if (sourceHeaders.length && sourceHeaders.length < width)
    warnings.push('Extra cells have been preserved in additional columns.');
  if (parsed.some(row => row.length < width))
    warnings.push('Missing cells will be empty.');
  return {
    headers,
    rows: parsed.map(row => headers.map((_, i) => row[i] ?? '')),
    warnings,
  };
}

export function csvDate(value: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match)
    throw new Error(
      'Dates must use YYYY-MM-DD. Choose Text to keep other date formats.'
    );
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    throw new Error(
      'The date is invalid. Choose Text to keep the original value.'
    );
  return date.getTime();
}

export function convertCsvValue(
  value: string,
  type: CsvColumnType
): string | number | boolean | null {
  if (type === 'number') {
    if (!value.trim()) return null;
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ||
      !Number.isFinite(Number(value))
    )
      throw new Error('The value is not a number. Choose Text to preserve it.');
    const number = Number(value);
    if (
      (Number.isInteger(number) && !Number.isSafeInteger(number)) ||
      canonicalNumber(value.trim()) !== canonicalNumber(String(number))
    )
      throw new Error(
        'This number cannot be stored without losing precision. Choose Text to preserve the original value.'
      );
    if (csvNumberDecimalPlaces(value) > 20)
      throw new Error(
        'This number needs more than 20 decimal places. Choose Text to preserve the original value.'
      );
    return number;
  }
  if (type === 'date') return csvDate(value.trim());
  if (type === 'checkbox') {
    if (!value.trim()) return null;
    if (!/^(true|false|yes|no|1|0)$/i.test(value.trim()))
      throw new Error('Checkboxes accept true/false, yes/no, or 1/0.');
    return /^(true|yes|1)$/i.test(value.trim());
  }
  return value;
}

function canonicalNumber(value: string): string {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(
    value
  );
  if (!match) return '';
  const fraction = match[3] ?? match[4] ?? '';
  const digits = `${match[2] ?? '0'}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/, '');
  const exponent =
    Number(match[5] ?? 0) -
    fraction.length +
    digits.length -
    significant.length;
  return `${match[1] === '-' ? '-' : ''}${significant}e${exponent}`;
}

export function csvNumberDecimalPlaces(value: string): number {
  const canonical = canonicalNumber(value.trim());
  if (!canonical || canonical === '0') return 0;
  const exponent = Number(canonical.slice(canonical.lastIndexOf('e') + 1));
  return Math.max(0, -exponent);
}

export function suggestCsvMapping(preview: CsvPreview): CsvMapping[] {
  return preview.headers.map((name, i) => {
    if (i === 0) return { name, type: 'title' };
    const values = preview.rows
      .map(row => row[i] ?? '')
      .filter(value => value !== '');
    let type: CsvColumnType = 'rich-text';
    // Leading zero identifiers and ambiguous dates stay text by default.
    if (
      values.length &&
      values.every(value => /^(true|false|yes|no)$/i.test(value))
    )
      type = 'checkbox';
    else if (
      values.length &&
      values.every(
        value =>
          /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
          (() => {
            try {
              convertCsvValue(value, 'number');
              return true;
            } catch {
              return false;
            }
          })()
      )
    )
      type = 'number';
    else if (
      values.length &&
      values.every(value => {
        try {
          return csvDate(value) !== null;
        } catch {
          return false;
        }
      })
    )
      type = 'date';
    return { name, type };
  });
}

export function validateCsvMapping(
  preview: CsvPreview,
  mapping: CsvMapping[]
): string[] {
  const errors: string[] = [];
  if (mapping.length !== preview.headers.length)
    return ['Every column needs a type.'];
  if (mapping.filter(column => column.type === 'title').length !== 1)
    errors.push('Choose exactly one Title column.');
  mapping.forEach((column, index) => {
    if (column.type !== 'skip' && !column.name.trim())
      errors.push(`Column ${index + 1} needs a name.`);
    if (column.type === 'skip') return;
    preview.rows.forEach((row, rowIndex) => {
      if (errors.length >= 10) return;
      try {
        convertCsvValue(row[index] ?? '', column.type);
      } catch (error) {
        errors.push(
          `Row ${rowIndex + 1}, ${column.name}: ${(error as Error).message}`
        );
      }
    });
  });
  return errors;
}

export function decodeCsv(bytes: Uint8Array, encoding = 'utf-8'): string {
  const bomEncoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : encoding;
  return new TextDecoder(bomEncoding, { fatal: true }).decode(bytes);
}
