import {
  createModal,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import type { Property } from '@blocksuite/data-view';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import { css, html, LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';

import type { DatabaseBlockDataSource } from '../../data-source.js';
import type { FormulaData } from './define.js';
import {
  computedText,
  type ComputedValue,
  type FormulaPropertyDescriptor,
  isComputedError,
  resolveFormulaPropertyRef,
  type SupportedFormulaFunctionName,
  validateFormulaSyntax,
} from './evaluate.js';

export type FormulaFunctionCategory = 'logic' | 'math' | 'text' | 'date';

export type FormulaFunctionTemplate = {
  name: SupportedFormulaFunctionName;
  category: FormulaFunctionCategory;
  signature: string;
  template: string;
  cursorOffset: number;
  description: string;
  example: string;
};

export const FORMULA_RESULT_TYPES: readonly {
  value: FormulaData['resultType'];
  label: string;
}[] = [
  { value: 'number', label: 'Number' },
  { value: 'string', label: 'Text' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
];

export const FORMULA_FUNCTION_TEMPLATES: readonly FormulaFunctionTemplate[] = [
  {
    name: 'if',
    category: 'logic',
    signature: 'if(condition, thenValue, elseValue)',
    template: 'if(, , )',
    cursorOffset: 3,
    description: 'Return the second argument when true, otherwise the third.',
    example: 'if(true, 1, 0)',
  },
  {
    name: 'empty',
    category: 'logic',
    signature: 'empty(value)',
    template: 'empty()',
    cursorOffset: 6,
    description: 'Return true when a value is null or empty text.',
    example: 'empty("")',
  },
  {
    name: 'abs',
    category: 'math',
    signature: 'abs(number)',
    template: 'abs()',
    cursorOffset: 4,
    description: 'Absolute value of a number.',
    example: 'abs(-5)',
  },
  {
    name: 'round',
    category: 'math',
    signature: 'round(number)',
    template: 'round()',
    cursorOffset: 6,
    description: 'Round a number to the nearest integer.',
    example: 'round(3.6)',
  },
  {
    name: 'floor',
    category: 'math',
    signature: 'floor(number)',
    template: 'floor()',
    cursorOffset: 6,
    description: 'Round a number down to the nearest integer.',
    example: 'floor(3.9)',
  },
  {
    name: 'ceil',
    category: 'math',
    signature: 'ceil(number)',
    template: 'ceil()',
    cursorOffset: 5,
    description: 'Round a number up to the nearest integer.',
    example: 'ceil(3.1)',
  },
  {
    name: 'min',
    category: 'math',
    signature: 'min(a, b, ...)',
    template: 'min(, )',
    cursorOffset: 4,
    description: 'Return the smallest of the given numbers.',
    example: 'min(3, 1, 2)',
  },
  {
    name: 'max',
    category: 'math',
    signature: 'max(a, b, ...)',
    template: 'max(, )',
    cursorOffset: 4,
    description: 'Return the largest of the given numbers.',
    example: 'max(3, 1, 2)',
  },
  {
    name: 'concat',
    category: 'text',
    signature: 'concat(text1, text2, ...)',
    template: 'concat(, )',
    cursorOffset: 7,
    description: 'Join two or more text values together.',
    example: 'concat("Hello", " ", "Nota")',
  },
  {
    name: 'lower',
    category: 'text',
    signature: 'lower(text)',
    template: 'lower()',
    cursorOffset: 6,
    description: 'Convert text to lowercase.',
    example: 'lower("NOTA")',
  },
  {
    name: 'upper',
    category: 'text',
    signature: 'upper(text)',
    template: 'upper()',
    cursorOffset: 6,
    description: 'Convert text to uppercase.',
    example: 'upper("nota")',
  },
  {
    name: 'length',
    category: 'text',
    signature: 'length(text)',
    template: 'length()',
    cursorOffset: 7,
    description: 'Return the character count of text.',
    example: 'length("nota")',
  },
  {
    name: 'format',
    category: 'text',
    signature: 'format(value)',
    template: 'format()',
    cursorOffset: 7,
    description: 'Convert a number, boolean, or null value into text.',
    example: 'format(42)',
  },
  {
    name: 'date',
    category: 'date',
    signature: 'date("YYYY-MM-DD")',
    template: 'date("2026-01-01")',
    cursorOffset: 6,
    description: 'Parse a UTC YYYY-MM-DD date string into a timestamp.',
    example: 'date("2026-10-05")',
  },
  {
    name: 'dateAdd',
    category: 'date',
    signature: 'dateAdd(timestamp, days)',
    template: 'dateAdd(, )',
    cursorOffset: 8,
    description: 'Add a number of UTC days to a date timestamp.',
    example: 'dateAdd(date("2026-10-05"), 2)',
  },
  {
    name: 'dateDiff',
    category: 'date',
    signature: 'dateDiff(timestampA, timestampB)',
    template: 'dateDiff(, )',
    cursorOffset: 9,
    description: 'Difference in UTC days between two date timestamps.',
    example: 'dateDiff(date("2026-10-07"), date("2026-10-05"))',
  },
];

export type FormulaPreviewResult =
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'syntax-ok'; message: string }
  | { kind: 'value'; value: ComputedValue; formatted: string };

export function insertFormulaSnippet(
  expression: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: string,
  cursorOffset = snippet.length
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, expression.length));
  const end = Math.max(start, Math.min(selectionEnd, expression.length));
  const value = expression.slice(0, start) + snippet + expression.slice(end);
  const clampedOffset = Math.max(0, Math.min(cursorOffset, snippet.length));
  return { value, cursor: start + clampedOffset };
}

export function buildPropertyReferenceSnippet(
  target: FormulaPropertyDescriptor,
  allProperties: readonly FormulaPropertyDescriptor[]
): string {
  const trimmedName = target.name.trim();
  if (trimmedName) {
    const resolved = resolveFormulaPropertyRef(target.name, allProperties);
    if (resolved.kind === 'resolved' && resolved.id === target.id) {
      return `prop(${JSON.stringify(target.name)})`;
    }
  }
  return `prop(${JSON.stringify(target.id)})`;
}

export function formatFormulaPreviewValue(
  value: ComputedValue,
  resultType: FormulaData['resultType']
): string {
  if (isComputedError(value)) return `#ERROR: ${value.error}`;
  if (value == null) return '(empty)';
  if (resultType === 'date' && typeof value === 'number') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  return computedText(value);
}

export function evaluateFormulaPreview(
  source: DatabaseBlockDataSource,
  options: {
    expression: string;
    resultType: FormulaData['resultType'];
    propertyId?: string;
    rowId?: string;
  }
): FormulaPreviewResult {
  const { expression, resultType, propertyId } = options;
  if (!expression.trim()) {
    return { kind: 'empty', message: 'Enter a formula expression' };
  }

  const syntax = validateFormulaSyntax(expression);
  if (!syntax.valid) {
    return { kind: 'error', message: syntax.error };
  }

  const rowId = options.rowId ?? source.rows$.value[0];
  if (!rowId) {
    for (const refName of syntax.propRefs) {
      const resolved = source.resolveFormulaProperty(refName);
      if (resolved.kind === 'missing') {
        return { kind: 'error', message: 'Referenced property is missing' };
      }
      if (resolved.kind === 'ambiguous') {
        return {
          kind: 'error',
          message: `Ambiguous property name: "${refName}" (use column ID)`,
        };
      }
      if (propertyId && resolved.id === propertyId) {
        return { kind: 'error', message: 'Circular property reference' };
      }
    }
    if (syntax.propRefs.length === 0) {
      const value = source.previewFormula(
        undefined,
        expression,
        resultType,
        propertyId
      );
      if (isComputedError(value)) {
        return { kind: 'error', message: value.error };
      }
      return {
        kind: 'value',
        value,
        formatted: formatFormulaPreviewValue(value, resultType),
      };
    }
    return {
      kind: 'syntax-ok',
      message: 'Syntax valid — add a row to preview values',
    };
  }

  const value = source.previewFormula(
    rowId,
    expression,
    resultType,
    propertyId
  );
  if (isComputedError(value)) {
    return { kind: 'error', message: value.error };
  }
  return {
    kind: 'value',
    value,
    formatted: formatFormulaPreviewValue(value, resultType),
  };
}

const FORMULA_EDITOR_TAG = 'affine-database-formula-editor';

const CATEGORY_TABS: readonly {
  id: 'all' | FormulaFunctionCategory;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'logic', label: 'Logic' },
  { id: 'math', label: 'Math' },
  { id: 'text', label: 'Text' },
  { id: 'date', label: 'Date' },
];

export class FormulaEditor extends LitElement {
  static override styles = css`
    :host {
      position: absolute;
      z-index: 1002;
      display: block;
      width: min(440px, calc(100vw - 24px));
      font-family: var(--affine-font-family, sans-serif);
      color: var(--affine-text-primary-color, #121212);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      border-radius: 10px;
      background: var(
        --affine-background-overlay-panel-color,
        var(--affine-background-primary-color, #ffffff)
      );
      border: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.12));
      box-shadow: var(--affine-menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.14));
      box-sizing: border-box;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .title {
      font-size: 13px;
      font-weight: 600;
      line-height: 18px;
    }

    .column-badge {
      font-size: 11px;
      line-height: 16px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--affine-background-secondary-color, rgba(0, 0, 0, 0.05));
      color: var(--affine-text-secondary-color, #666);
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .close-btn {
      border: 0;
      background: transparent;
      color: var(--affine-text-secondary-color, #666);
      cursor: pointer;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      font-size: 16px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.06));
      color: var(--affine-text-primary-color, #121212);
    }

    .expression-input {
      width: 100%;
      min-height: 84px;
      resize: vertical;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.16));
      background: var(--affine-background-primary-color, #fff);
      color: var(--affine-text-primary-color, #121212);
      font-family: var(
        --affine-font-code-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        monospace
      );
      font-size: 13px;
      line-height: 1.5;
      box-sizing: border-box;
      outline: none;
    }

    .expression-input:focus {
      border-color: var(--affine-primary-color, #1e96eb);
      box-shadow: 0 0 0 2px rgba(30, 150, 235, 0.16);
    }

    .expression-input.has-error {
      border-color: var(--affine-error-color, #eb4335);
    }

    .preview-box {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 18px;
      background: var(--affine-background-secondary-color, rgba(0, 0, 0, 0.04));
      border: 1px solid transparent;
    }

    .preview-box.error {
      background: var(--affine-background-error-color, rgba(235, 67, 53, 0.08));
      border-color: rgba(235, 67, 53, 0.25);
      color: var(--affine-error-color, #c9342a);
    }

    .preview-label {
      font-weight: 600;
      color: var(--affine-text-secondary-color, #666);
      flex-shrink: 0;
    }

    .preview-box.error .preview-label {
      color: inherit;
    }

    .preview-value {
      font-family: var(
        --affine-font-code-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace
      );
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: right;
    }

    .preview-muted {
      color: var(--affine-text-secondary-color, #777);
      font-style: italic;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--affine-text-secondary-color, #666);
    }

    .segmented {
      display: inline-flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .seg-btn {
      border: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.12));
      background: transparent;
      color: var(--affine-text-secondary-color, #555);
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 12px;
      line-height: 16px;
      cursor: pointer;
    }

    .seg-btn:hover {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.05));
      color: var(--affine-text-primary-color, #121212);
    }

    .seg-btn.active {
      background: var(--affine-primary-color, #1e96eb);
      border-color: var(--affine-primary-color, #1e96eb);
      color: #ffffff;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      max-height: 92px;
      overflow-y: auto;
    }

    .chip {
      border: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.12));
      background: var(--affine-background-secondary-color, rgba(0, 0, 0, 0.03));
      color: var(--affine-text-primary-color, #121212);
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 12px;
      line-height: 18px;
      cursor: pointer;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chip:hover {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.08));
      border-color: var(--affine-primary-color, #1e96eb);
    }

    .chip.fn {
      font-family: var(
        --affine-font-code-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace
      );
      font-size: 11px;
    }

    .fn-hint {
      font-size: 11px;
      line-height: 16px;
      color: var(--affine-text-secondary-color, #666);
      min-height: 16px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .fn-hint code {
      font-family: var(
        --affine-font-code-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace
      );
      color: var(--affine-text-primary-color, #121212);
    }

    .cat-tabs {
      display: inline-flex;
      gap: 2px;
    }

    .cat-tab {
      border: 0;
      background: transparent;
      color: var(--affine-text-secondary-color, #666);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      cursor: pointer;
    }

    .cat-tab:hover {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.06));
    }

    .cat-tab.active {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.1));
      color: var(--affine-text-primary-color, #121212);
      font-weight: 600;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 4px;
      border-top: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.08));
    }

    .shortcut-hint {
      font-size: 11px;
      color: var(--affine-text-secondary-color, #777);
    }

    .actions {
      display: flex;
      gap: 6px;
    }

    .btn {
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 500;
      line-height: 18px;
      cursor: pointer;
      border: 1px solid var(--affine-border-color, rgba(0, 0, 0, 0.14));
      background: transparent;
      color: var(--affine-text-primary-color, #121212);
    }

    .btn:hover {
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.06));
    }

    .btn.primary {
      background: var(--affine-primary-color, #1e96eb);
      border-color: var(--affine-primary-color, #1e96eb);
      color: #ffffff;
    }

    .btn.primary:hover {
      opacity: 0.92;
    }

    .empty-note {
      font-size: 12px;
      color: var(--affine-text-secondary-color, #777);
    }
  `;

  private readonly textareaRef = createRef<HTMLTextAreaElement>();

  @property({ attribute: false })
  accessor dataSource!: DatabaseBlockDataSource;

  @property({ attribute: false })
  accessor formulaProperty!: Property;

  @property({ attribute: false })
  accessor onClose: (() => void) | undefined = undefined;

  @state()
  accessor expression = '';

  @state()
  accessor resultType: FormulaData['resultType'] = 'number';

  @state()
  accessor selectedCategory: 'all' | FormulaFunctionCategory = 'all';

  @state()
  accessor hoveredFunction: FormulaFunctionTemplate | null = null;

  override connectedCallback() {
    super.connectedCallback();
    const data = this.formulaProperty?.data$.value;
    this.expression = String(data?.expression ?? '');
    const rawType = data?.resultType;
    this.resultType =
      rawType === 'string' || rawType === 'boolean' || rawType === 'date'
        ? rawType
        : 'number';
  }

  override firstUpdated() {
    requestAnimationFrame(() => {
      const textarea = this.textareaRef.value;
      if (textarea) {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    });
  }

  private get availableProperties(): FormulaPropertyDescriptor[] {
    if (!this.dataSource || !this.formulaProperty) return [];
    return this.dataSource
      .formulaPropertyDescriptors()
      .filter(
        prop => prop.id !== this.formulaProperty.id && prop.id !== 'type'
      );
  }

  private insertAtCursor(snippet: string, cursorOffset = snippet.length) {
    const textarea = this.textareaRef.value;
    const start = textarea?.selectionStart ?? this.expression.length;
    const end = textarea?.selectionEnd ?? this.expression.length;
    const next = insertFormulaSnippet(
      this.expression,
      start,
      end,
      snippet,
      cursorOffset
    );
    this.expression = next.value;
    requestAnimationFrame(() => {
      const input = this.textareaRef.value;
      if (input) {
        input.focus();
        input.setSelectionRange(next.cursor, next.cursor);
      }
    });
  }

  private readonly handleInsertProperty = (
    target: FormulaPropertyDescriptor
  ) => {
    const allProperties = this.dataSource.formulaPropertyDescriptors();
    const snippet = buildPropertyReferenceSnippet(target, allProperties);
    this.insertAtCursor(snippet);
  };

  private readonly handleInsertFunction = (fn: FormulaFunctionTemplate) => {
    this.insertAtCursor(fn.template, fn.cursorOffset);
  };

  private readonly handleSave = () => {
    this.dataSource.doc.captureSync();
    this.formulaProperty.dataUpdate(() => ({
      expression: this.expression,
      resultType: this.resultType,
    }));
    this.onClose?.();
  };

  private readonly handleCancel = () => {
    this.onClose?.();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handleCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.handleSave();
    }
  };

  private readonly stopBubble = (event: Event) => {
    event.stopPropagation();
  };

  private readonly keepTextareaFocus = (event: MouseEvent) => {
    event.preventDefault();
  };

  override render() {
    const properties = this.availableProperties;
    const preview = this.dataSource
      ? evaluateFormulaPreview(this.dataSource, {
          expression: this.expression,
          resultType: this.resultType,
          propertyId: this.formulaProperty?.id,
        })
      : { kind: 'empty' as const, message: 'Enter a formula expression' };

    const functions =
      this.selectedCategory === 'all'
        ? FORMULA_FUNCTION_TEMPLATES
        : FORMULA_FUNCTION_TEMPLATES.filter(
            fn => fn.category === this.selectedCategory
          );

    const hasError = preview.kind === 'error';
    const columnName = this.formulaProperty?.name$.value || 'Formula';

    return html`
      <div
        class="panel"
        data-testid="database-formula-editor"
        @pointerdown=${this.stopBubble}
        @mousedown=${this.stopBubble}
        @click=${this.stopBubble}
        @keydown=${this.handleKeyDown}
        @copy=${this.stopBubble}
        @cut=${this.stopBubble}
        @paste=${this.stopBubble}
      >
        <div class="header">
          <div class="title-group">
            <span class="title">Edit formula</span>
            <span class="column-badge" title=${columnName}>${columnName}</span>
          </div>
          <button
            type="button"
            class="close-btn"
            aria-label="Close formula editor"
            @click=${this.handleCancel}
          >
            ×
          </button>
        </div>

        <textarea
          ${ref(this.textareaRef)}
          class="expression-input ${hasError ? 'has-error' : ''}"
          rows="4"
          spellcheck="false"
          placeholder='e.g. prop("Price") * prop("Qty")'
          .value=${this.expression}
          @input=${(event: Event) => {
            this.expression = (event.target as HTMLTextAreaElement).value;
          }}
        ></textarea>

        <div
          class="preview-box ${hasError ? 'error' : ''}"
          data-testid="formula-live-preview"
        >
          <span class="preview-label"
            >${hasError ? 'Error' : 'Row 1 preview'}</span
          >
          <span
            class="preview-value ${
              preview.kind === 'empty' || preview.kind === 'syntax-ok'
                ? 'preview-muted'
                : ''
            }"
            title=${
              preview.kind === 'value' ? preview.formatted : preview.message
            }
          >
            ${preview.kind === 'value' ? preview.formatted : preview.message}
          </span>
        </div>

        <div class="section">
          <div class="section-header">
            <span class="section-label">Result type</span>
            <div class="segmented" role="radiogroup" aria-label="Result type">
              ${FORMULA_RESULT_TYPES.map(
                item => html`
                  <button
                    type="button"
                    class="seg-btn ${
                      this.resultType === item.value ? 'active' : ''
                    }"
                    @mousedown=${this.keepTextareaFocus}
                    @click=${() => {
                      this.resultType = item.value;
                    }}
                  >
                    ${item.label}
                  </button>
                `
              )}
            </div>
          </div>
        </div>

        <div class="section">
          <span class="section-label">Properties</span>
          ${
            properties.length
              ? html`
                  <div class="chip-list">
                    ${properties.map(
                      prop => html`
                        <button
                          type="button"
                          class="chip"
                          title=${`Insert prop(${JSON.stringify(prop.name || prop.id)})`}
                          @mousedown=${this.keepTextareaFocus}
                          @click=${() => this.handleInsertProperty(prop)}
                        >
                          ${prop.name || prop.id}
                        </button>
                      `
                    )}
                  </div>
                `
              : html`<span class="empty-note"
                  >No other properties in this database.</span
                >`
          }
        </div>

        <div class="section">
          <div class="section-header">
            <span class="section-label">Functions</span>
            <div class="cat-tabs">
              ${CATEGORY_TABS.map(
                tab => html`
                  <button
                    type="button"
                    class="cat-tab ${
                      this.selectedCategory === tab.id ? 'active' : ''
                    }"
                    @mousedown=${this.keepTextareaFocus}
                    @click=${() => {
                      this.selectedCategory = tab.id;
                    }}
                  >
                    ${tab.label}
                  </button>
                `
              )}
            </div>
          </div>
          <div class="chip-list">
            ${functions.map(
              fn => html`
                <button
                  type="button"
                  class="chip fn"
                  title=${`${fn.signature} — ${fn.description}`}
                  @mousedown=${this.keepTextareaFocus}
                  @mouseenter=${() => {
                    this.hoveredFunction = fn;
                  }}
                  @mouseleave=${() => {
                    if (this.hoveredFunction === fn) {
                      this.hoveredFunction = null;
                    }
                  }}
                  @click=${() => this.handleInsertFunction(fn)}
                >
                  ${fn.name}()
                </button>
              `
            )}
          </div>
          <div class="fn-hint">
            ${
              this.hoveredFunction
                ? html`<code>${this.hoveredFunction.signature}</code> —
                    ${this.hoveredFunction.description}`
                : html`Operators:
                    <code
                      >+ - * / % == != &lt; &lt;= &gt; &gt;= &amp;&amp; ||
                      !</code
                    >`
            }
          </div>
        </div>

        <div class="footer">
          <span class="shortcut-hint">⌘/Ctrl + Enter to save</span>
          <div class="actions">
            <button
              type="button"
              class="btn"
              data-testid="formula-cancel-btn"
              @click=${this.handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn primary"
              data-testid="formula-save-btn"
              @click=${this.handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

if (
  typeof customElements !== 'undefined' &&
  !customElements.get(FORMULA_EDITOR_TAG)
) {
  customElements.define(FORMULA_EDITOR_TAG, FormulaEditor);
}

let activeFormulaEditorClose: (() => void) | null = null;

export function popFormulaEditor(
  anchor: HTMLElement,
  formulaProperty: Property
): () => void {
  activeFormulaEditorClose?.();

  const source = formulaProperty.view.manager
    .dataSource as DatabaseBlockDataSource;
  const editor = new FormulaEditor();
  editor.dataSource = source;
  editor.formulaProperty = formulaProperty;

  const target = popupTargetFromElement(anchor);
  const popupEnd = target.popupStart();
  const modal = createModal(target.root);
  modal.append(editor);

  const cleanupPosition = autoUpdate(target.targetRect, editor, () => {
    const viewportPadding = { top: 64, right: 12, bottom: 12, left: 12 };
    computePosition(target.targetRect, editor, {
      placement: 'bottom-start',
      middleware: [
        offset(6),
        flip({ padding: viewportPadding }),
        shift({ padding: viewportPadding, crossAxis: true }),
      ],
    })
      .then(({ x, y }) => {
        editor.style.left = `${x}px`;
        editor.style.top = `${Math.max(64, y)}px`;
      })
      .catch(() => {});
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    cleanupPosition();
    modal.remove();
    popupEnd();
    if (activeFormulaEditorClose === close) {
      activeFormulaEditorClose = null;
    }
  };

  modal.onpointerdown = ev => {
    if (ev.target === modal) close();
  };
  modal.onmousedown = ev => {
    if (ev.target === modal) close();
  };
  modal.oncontextmenu = ev => {
    ev.preventDefault();
    if (ev.target === modal) close();
  };

  editor.onClose = close;
  activeFormulaEditorClose = close;
  return close;
}
