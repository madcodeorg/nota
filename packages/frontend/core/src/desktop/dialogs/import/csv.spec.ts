import { csvFormatRows } from 'd3-dsv';
import { describe, expect, test } from 'vitest';

import {
  convertCsvValue,
  decodeCsv,
  parseCsv,
  suggestCsvMapping,
  validateCsvMapping,
} from './csv';

describe('CSV preview and mapping', () => {
  test('keeps duplicate headers, quoted commas, escaped quotes and multiline cells', () => {
    const preview = parseCsv(
      '\uFEFFName,Note,Note\r\n"A, B","say ""hello""","first\r\nsecond"\r\nC,only'
    );
    expect(preview.headers).toEqual(['Name', 'Note', 'Note']);
    expect(preview.rows).toEqual([
      ['A, B', 'say "hello"', 'first\r\nsecond'],
      ['C', 'only', ''],
    ]);
    expect(preview.warnings).toHaveLength(2);
    expect(
      parseCsv(csvFormatRows([preview.headers, ...preview.rows])).rows
    ).toEqual(preview.rows);
  });
  test('supports no header and explicit separators while preserving extra cells', () => {
    expect(parseCsv('Alice;1\nBob;2', ';', false)).toMatchObject({
      headers: ['Column 1', 'Column 2'],
      rows: [
        ['Alice', '1'],
        ['Bob', '2'],
      ],
    });
    expect(parseCsv('Name\nAlice,extra').headers).toEqual(['Name', 'Column 2']);
    expect(parseCsv('Name\tNote\nAlice\tvalue', '\t').rows).toEqual([
      ['Alice', 'value'],
    ]);
  });
  test('rejects unfinished quotes and malformed fields', () => {
    expect(() => parseCsv('Name\n"missing')).toThrow('unfinished');
    expect(() => parseCsv('Name\n"closed"junk')).toThrow('quoting');
    expect(() => parseCsv('')).toThrow('empty');
    expect(() => parseCsv('Name\n' + 'a\n'.repeat(10001))).toThrow('10,000');
  });
  test('only suggests unambiguous types and does not treat leading-zero ids as numbers', () => {
    const preview = parseCsv(
      'Name,ID,Count,Done,Date,Ambiguous\nA,001,2,true,2026-10-05,10/05/2026\nB,002,0,false,2026-10-06,10/06/2026'
    );
    expect(suggestCsvMapping(preview).map(column => column.type)).toEqual([
      'title',
      'rich-text',
      'number',
      'checkbox',
      'date',
      'rich-text',
    ]);
  });
  test('rejects lossy conversions with row/column context before import', () => {
    const preview = parseCsv('Name,Value\nA,1xx');
    expect(
      validateCsvMapping(preview, [
        { name: 'Name', type: 'title' },
        { name: 'Value', type: 'number' },
      ])[0]
    ).toContain('Row 1, Value');
    expect(convertCsvValue('0', 'number')).toBe(0);
    expect(convertCsvValue('', 'number')).toBeNull();
    expect(convertCsvValue('', 'checkbox')).toBeNull();
    expect(convertCsvValue('false', 'checkbox')).toBe(false);
    expect(() => convertCsvValue('2026-02-30', 'date')).toThrow('invalid');
    expect(() => convertCsvValue('10/05/2026', 'date')).toThrow('YYYY-MM-DD');
    expect(() => convertCsvValue('maybe', 'checkbox')).toThrow('Checkboxes');
  });
  test('keeps long numeric identifiers as text and rejects unsafe integer/scientific precision loss', () => {
    const preview = parseCsv(
      'Name,Identifier\nA,9007199254740993\nB,9007199254740992'
    );
    expect(suggestCsvMapping(preview)[1].type).toBe('rich-text');
    for (const value of [
      '9007199254740993',
      '9.007199254740993e15',
      '9007199254740991.1',
      '0.10000000000000001',
      '1e-9999',
    ])
      expect(() => convertCsvValue(value, 'number')).toThrow('precision');
    expect(convertCsvValue('9007199254740991', 'number')).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(convertCsvValue('1.2000e2', 'number')).toBe(120);
    expect(convertCsvValue('0.1', 'number')).toBe(0.1);
    expect(() => convertCsvValue('1e-21', 'number')).toThrow(
      '20 decimal places'
    );
    expect(
      validateCsvMapping(preview, [
        { name: 'Name', type: 'title' },
        { name: 'Identifier', type: 'number' },
      ])[0]
    ).toContain('Choose Text');
  });

  test('decodes BOM UTF-16 and permits explicit legacy encodings', () => {
    expect(decodeCsv(new Uint8Array([0xff, 0xfe, 65, 0, 44, 0, 66, 0]))).toBe(
      'A,B'
    );
    expect(decodeCsv(new Uint8Array([0xe9]), 'windows-1252')).toBe('é');
    expect(() => decodeCsv(new Uint8Array([0xff]))).toThrow();
  });
});
