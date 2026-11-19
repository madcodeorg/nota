import { describe, expect, test } from 'vitest';

import {
  aggregateRollup,
  computedText,
  evaluateFormula,
  resolveFormulaPropertyRef,
  SUPPORTED_FORMULA_FUNCTIONS,
  validateFormulaSyntax,
} from '../properties/computed/evaluate.js';
import {
  buildPropertyReferenceSnippet,
  formatFormulaPreviewValue,
  FORMULA_FUNCTION_TEMPLATES,
  insertFormulaSnippet,
} from '../properties/computed/formula-editor.js';

describe('bounded database formulas', () => {
  test('evaluates arithmetic and compares stable column references', () => {
    expect(
      evaluateFormula(
        'if(prop("price-id") > 0, prop("price-id") * 2 + 1, 0)',
        id => (id === 'price-id' ? 4 : null)
      )
    ).toBe(9);
    expect(evaluateFormula('2 + 3 * 4', () => null)).toBe(14);
    expect(
      evaluateFormula('concat(upper("nota"), " ", format(2))', () => null)
    ).toBe('NOTA 2');
  });
  test('only evaluates the selected conditional or boolean branch', () => {
    expect(evaluateFormula('if(false, 1 / 0, 5)', () => null)).toBe(5);
    expect(evaluateFormula('false && (1 / 0 == 1)', () => null)).toBe(false);
  });
  test('null and incorrect types stay explicit', () => {
    expect(evaluateFormula('empty(prop("missing"))', () => null)).toBe(true);
    expect(evaluateFormula('prop("missing") + 1', () => null)).toEqual({
      error: 'Expected a finite number',
    });
    expect(evaluateFormula('1 / 0', () => null)).toEqual({
      error: 'Division by zero',
    });
    expect(
      evaluateFormula('prop("a")', () => ({
        error: 'Circular property reference',
      }))
    ).toEqual({ error: 'Circular property reference' });
  });
  test('date helpers use valid UTC dates and day units', () => {
    expect(
      evaluateFormula(
        'dateDiff(dateAdd(date("2026-10-05"), 2), date("2026-10-05"))',
        () => null
      )
    ).toBe(2);
    expect(evaluateFormula('date("2026-02-30")', () => null)).toEqual({
      error: 'Invalid date',
    });
  });
  test('rejects code execution, unknown functions and excessive complexity', () => {
    for (const formula of [
      'globalThis.fetch("url")',
      'constructor("code")',
      'prop("x")[0]',
      '1;2',
      'new Date()',
    ]) {
      expect(evaluateFormula(formula, () => null)).toHaveProperty('error');
    }
    expect(
      evaluateFormula('('.repeat(40) + '1' + ')'.repeat(40), () => null)
    ).toHaveProperty('error');
    expect(evaluateFormula('1+'.repeat(130) + '1', () => null)).toHaveProperty(
      'error'
    );
    expect(
      evaluateFormula('"' + 'x'.repeat(4096) + '"', () => null)
    ).toHaveProperty('error');
  });
});

describe('numeric database rollups', () => {
  test('lists readable values and removes duplicates only for unique values', () => {
    expect(
      aggregateRollup('values', [['Done', 'Review'], null, 'Done', ''])
    ).toEqual(['Done', 'Review', 'Done', '']);
    expect(
      aggregateRollup('unique', [['Done', 'Review'], null, 'Done'])
    ).toEqual(['Done', 'Review']);
    expect(aggregateRollup('values', [])).toEqual([]);
    expect(aggregateRollup('values', [4])).toEqual({
      error: 'Rollup requires readable values',
    });
    expect(
      aggregateRollup('values', [Array.from({ length: 10001 }, () => 'x')])
    ).toEqual({
      error: 'Rollup value limit exceeded',
    });
    expect(computedText(['Done', 'Review'])).toBe('Done, Review');
  });
  test('counts rows and aggregates numeric values without treating null as zero', () => {
    expect(aggregateRollup('count', [null, 0, 4])).toBe(3);
    expect(aggregateRollup('sum', [null, 0, 4])).toBe(4);
    expect(aggregateRollup('avg', [null, 0, 4])).toBe(2);
    expect(aggregateRollup('min', [3, 0, 4])).toBe(0);
    expect(aggregateRollup('max', [3, 0, 4])).toBe(4);
    expect(aggregateRollup('avg', [])).toBe(null);
    expect(aggregateRollup('sum', [])).toBe(0);
  });
  test('retains errors and rejects nonnumeric values', () => {
    expect(aggregateRollup('sum', [{ error: 'Unavailable target' }])).toEqual({
      error: 'Unavailable target',
    });
    expect(aggregateRollup('sum', ['4'])).toEqual({
      error: 'Rollup requires numeric values',
    });
  });
});

describe('formula property name resolution', () => {
  const properties = [
    { id: 'col-price', name: 'Price' },
    { id: 'col-qty', name: 'Qty' },
    { id: 'title', name: 'Title' },
  ];

  test('resolves by column ID first and falls back to case-insensitive column name', () => {
    expect(resolveFormulaPropertyRef('col-price', properties)).toEqual({
      kind: 'resolved',
      id: 'col-price',
    });
    expect(resolveFormulaPropertyRef('Price', properties)).toEqual({
      kind: 'resolved',
      id: 'col-price',
    });
    expect(resolveFormulaPropertyRef('price', properties)).toEqual({
      kind: 'resolved',
      id: 'col-price',
    });
    expect(resolveFormulaPropertyRef('  QTY  ', properties)).toEqual({
      kind: 'resolved',
      id: 'col-qty',
    });
    expect(resolveFormulaPropertyRef('missing', properties)).toEqual({
      kind: 'missing',
    });
    expect(resolveFormulaPropertyRef('   ', properties)).toEqual({
      kind: 'missing',
    });

    // Exact column ID wins even if another column is named identically to the ID.
    expect(
      resolveFormulaPropertyRef('col-a', [
        { id: 'col-b', name: 'col-a' },
        { id: 'col-a', name: 'Actual A' },
      ])
    ).toEqual({ kind: 'resolved', id: 'col-a' });
  });

  test('detects ambiguous duplicate names while allowing exact-case or ID disambiguation', () => {
    const duplicateExact = [
      { id: 'c1', name: 'Price' },
      { id: 'c2', name: 'Price' },
    ];
    expect(resolveFormulaPropertyRef('Price', duplicateExact)).toEqual({
      kind: 'ambiguous',
      matches: ['c1', 'c2'],
    });
    expect(resolveFormulaPropertyRef('c1', duplicateExact)).toEqual({
      kind: 'resolved',
      id: 'c1',
    });

    const caseCollision = [
      { id: 'c1', name: 'Price' },
      { id: 'c2', name: 'price' },
    ];
    expect(resolveFormulaPropertyRef('Price', caseCollision)).toEqual({
      kind: 'resolved',
      id: 'c1',
    });
    expect(resolveFormulaPropertyRef('PRICE', caseCollision)).toEqual({
      kind: 'ambiguous',
      matches: ['c1', 'c2'],
    });
  });

  test('evaluateFormula resolves both column names and legacy column IDs', () => {
    const values: Record<string, unknown> = {
      'col-price': 12.5,
      'col-qty': 4,
    };
    expect(
      evaluateFormula(
        'prop("Price") * prop("qty")',
        id => values[id] ?? null,
        properties
      )
    ).toBe(50);
    expect(
      evaluateFormula(
        'prop("col-price") * prop("col-qty")',
        id => values[id] ?? null,
        properties
      )
    ).toBe(50);
    expect(
      evaluateFormula('prop("Price")', () => 1, [
        { id: 'c1', name: 'Price' },
        { id: 'c2', name: 'Price' },
      ])
    ).toEqual({ error: 'Ambiguous property name: "Price" (use column ID)' });
  });
});

describe('formula editor helpers and supported function catalog', () => {
  test('function catalog matches evaluate.ts 1-to-1 and every example evaluates without error', () => {
    const templateNames = FORMULA_FUNCTION_TEMPLATES.map(fn => fn.name);
    expect(new Set(templateNames)).toEqual(
      new Set(SUPPORTED_FORMULA_FUNCTIONS)
    );
    expect(templateNames.length).toBe(SUPPORTED_FORMULA_FUNCTIONS.length);

    for (const fn of FORMULA_FUNCTION_TEMPLATES) {
      expect(fn.signature.length).toBeGreaterThan(0);
      expect(fn.description.length).toBeGreaterThan(0);
      expect(fn.cursorOffset).toBeGreaterThan(0);
      expect(fn.cursorOffset).toBeLessThanOrEqual(fn.template.length);

      const syntax = validateFormulaSyntax(fn.example);
      expect(syntax, `${fn.name} example syntax`).toEqual({
        valid: true,
        propRefs: [],
      });

      const result = evaluateFormula(fn.example, () => null);
      expect(result, `${fn.name} example evaluation`).not.toHaveProperty(
        'error'
      );
    }
  });

  test('validateFormulaSyntax rejects unknown functions and arity mismatches', () => {
    expect(validateFormulaSyntax('')).toEqual({
      valid: false,
      error: 'Configure the formula',
    });
    expect(validateFormulaSyntax('sum(1, 2)')).toEqual({
      valid: false,
      error: 'Unknown function: sum',
    });
    expect(validateFormulaSyntax('round(1, 2)')).toEqual({
      valid: false,
      error: 'round needs one argument',
    });
    expect(validateFormulaSyntax('if(true, 1)')).toEqual({
      valid: false,
      error: 'if needs three arguments',
    });
    expect(validateFormulaSyntax('dateAdd(1)')).toEqual({
      valid: false,
      error: 'dateAdd needs two arguments',
    });
    expect(validateFormulaSyntax('min()')).toEqual({
      valid: false,
      error: 'min needs values',
    });
    expect(validateFormulaSyntax('prop(123)')).toEqual({
      valid: false,
      error: 'prop needs a quoted column name or ID',
    });
    expect(
      validateFormulaSyntax('if(prop("Price") > 0, prop("Qty"), 0)')
    ).toEqual({
      valid: true,
      propRefs: ['Price', 'Qty'],
    });
  });

  test('insertFormulaSnippet inserts at cursor or replaces selection', () => {
    expect(insertFormulaSnippet('prop("Price")', 13, 13, ' * 2')).toEqual({
      value: 'prop("Price") * 2',
      cursor: 17,
    });
    expect(insertFormulaSnippet('1 + 2', 2, 3, '*', 1)).toEqual({
      value: '1 * 2',
      cursor: 3,
    });
    expect(insertFormulaSnippet('', 0, 0, 'round()', 6)).toEqual({
      value: 'round()',
      cursor: 6,
    });
  });

  test('buildPropertyReferenceSnippet prefers readable names and falls back to ID on collision', () => {
    const uniqueProps = [
      { id: 'c1', name: 'Price' },
      { id: 'c2', name: 'Qty' },
    ];
    expect(buildPropertyReferenceSnippet(uniqueProps[0]!, uniqueProps)).toBe(
      'prop("Price")'
    );

    const collidingProps = [
      { id: 'c1', name: 'Price' },
      { id: 'c2', name: 'Price' },
      { id: 'c3', name: '   ' },
    ];
    expect(
      buildPropertyReferenceSnippet(collidingProps[0]!, collidingProps)
    ).toBe('prop("c1")');
    expect(
      buildPropertyReferenceSnippet(collidingProps[2]!, collidingProps)
    ).toBe('prop("c3")');
  });

  test('formatFormulaPreviewValue formats dates, nulls, errors, and scalars', () => {
    expect(formatFormulaPreviewValue(42, 'number')).toBe('42');
    expect(formatFormulaPreviewValue(null, 'number')).toBe('(empty)');
    expect(
      formatFormulaPreviewValue(Date.parse('2026-10-05T00:00:00Z'), 'date')
    ).toBe('2026-10-05');
    expect(
      formatFormulaPreviewValue({ error: 'Division by zero' }, 'number')
    ).toBe('#ERROR: Division by zero');
  });
});
