import { PeekViewProvider } from '@blocksuite/affine/components/peek';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import type { ColorScheme } from '@blocksuite/affine/model';
import {
  codeBlockWrapMiddleware,
  defaultImageProxyMiddleware,
  ImageProxyService,
} from '@blocksuite/affine/shared/adapters';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import {
  BlockStdScope,
  type EditorHost,
  ShadowlessElement,
} from '@blocksuite/affine/std';
import type {
  ExtensionType,
  Query,
  Store,
  TransformerMiddleware,
} from '@blocksuite/affine/store';
import { createReactComponentFromLit } from '@nota/component';
import type { FeatureFlagService } from '@nota/core/modules/feature-flag';
import type { Signal } from '@preact/signals-core';
import {
  darkCssVariablesV2,
  lightCssVariablesV2,
} from '@toeverything/theme/v2';
import { css, html, nothing, type PropertyValues, unsafeCSS } from 'lit';
import { property, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { keyed } from 'lit/directives/keyed.js';
import React from 'react';
import { filter } from 'rxjs/operators';

import { markDownToDoc } from '../../utils';
import type { AffineAIPanelState } from '../widgets/ai-panel/type';
import { getCustomPageEditorBlockSpecs } from './page-editor-block-specs';

const customHeadingStyles = css`
  .custom-heading {
    .h1 {
      font-size: calc(var(--affine-font-h-1) - 2px);
      code {
        font-size: calc(var(--affine-font-base) + 6px);
      }
    }
    .h2 {
      font-size: calc(var(--affine-font-h-2) - 2px);
      code {
        font-size: calc(var(--affine-font-base) + 4px);
      }
    }
    .h3 {
      font-size: calc(var(--affine-font-h-3) - 2px);
      code {
        font-size: calc(var(--affine-font-base) + 2px);
      }
    }
    .h4 {
      font-size: calc(var(--affine-font-h-4) - 2px);
      code {
        font-size: var(--affine-font-base);
      }
    }
    .h5 {
      font-size: calc(var(--affine-font-h-5) - 2px);
      code {
        font-size: calc(var(--affine-font-base) - 2px);
      }
    }
    .h6 {
      font-size: calc(var(--affine-font-h-6) - 2px);
      code {
        font-size: calc(var(--affine-font-base) - 4px);
      }
    }
  }
`;

const STREAMING_REVEAL_INTERVAL = 180;
const SOFT_CHUNK_MIN_LENGTH = 72;
const SOFT_CHUNK_MAX_LENGTH = 180;

export function takeNextStreamingTextReveal(text: string) {
  if (!text) return '';

  const newlineIndex = text.indexOf('\n');
  if (newlineIndex !== -1) {
    let end = newlineIndex + 1;
    while (text[end] === '\n') {
      end += 1;
    }
    return text.slice(0, end);
  }

  const sentenceEndPattern = /[.!?](?=\s|$)/g;
  for (const sentenceEnd of text.matchAll(sentenceEndPattern)) {
    const index = sentenceEnd.index ?? -1;
    const prefix = text.slice(0, index).trim();
    const isNumberedListMarker = /^\d+$/.test(prefix);
    if (isNumberedListMarker) continue;
    if (index >= 16 || index === text.trimEnd().length - 1) {
      return text.slice(0, index + 1);
    }
  }

  if (text.length >= SOFT_CHUNK_MAX_LENGTH) {
    const pivot = text.lastIndexOf(' ', SOFT_CHUNK_MAX_LENGTH);
    if (pivot >= SOFT_CHUNK_MIN_LENGTH) {
      return text.slice(0, pivot + 1);
    }
  }

  return '';
}

export type TextRendererOptions = {
  customHeading?: boolean;
  extensions?: ExtensionType[];
  additionalMiddlewares?: TransformerMiddleware[];
  testId?: string;
  affineFeatureFlagService?: FeatureFlagService;
  theme?: Signal<ColorScheme>;
};

// todo: refactor it for more general purpose usage instead of AI only?
export class TextRenderer extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    .ai-answer-text-editor.affine-page-viewport {
      background: transparent;
      font-family: var(--affine-font-family);
      margin-top: 0;
      margin-bottom: 0;
    }

    .ai-answer-text-editor .affine-page-root-block-container {
      padding: 0;
      margin: 0;
      line-height: var(--affine-line-height);
      color: ${unsafeCSSVarV2('text/primary')};
      font-weight: 400;
    }

    .ai-answer-text-editor {
      .affine-note-block-container {
        > .affine-block-children-container {
          > :first-child:not(affine-callout),
          > :first-child:not(affine-callout) * {
            margin-top: 0 !important;
          }
          > :last-child,
          > :last-child * {
            margin-bottom: 0 !important;
          }
        }
      }

      .affine-paragraph-block-container {
        line-height: 22px;

        .h6 {
          padding-left: 16px;
          color: ${unsafeCSSVarV2('text/link')};
          font-size: var(--affine-font-base);

          .toggle-icon {
            transform: translateX(0);
            svg {
              color: ${unsafeCSSVarV2('text/link')};
            }
          }
        }
      }
    }

    .text-renderer-container {
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0;
      overscroll-behavior-y: none;
    }

    .text-renderer-container[data-streaming='true'] .ai-answer-text-editor {
      animation: ai-answer-line-reveal 180ms ease-out;
    }

    .generating-pulse {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 18px;
      margin-top: 8px;
      color: var(--affine-primary-color);
    }

    .generating-pulse-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.35;
      animation: ai-generating-pulse 900ms ease-in-out infinite;
    }

    .generating-pulse-dot:nth-child(2) {
      animation-delay: 120ms;
    }

    .generating-pulse-dot:nth-child(3) {
      animation-delay: 240ms;
    }

    @keyframes ai-answer-line-reveal {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes ai-generating-pulse {
      0%,
      80%,
      100% {
        opacity: 0.35;
        transform: translateY(0);
      }
      40% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }

    .text-renderer-container.show-scrollbar::-webkit-scrollbar {
      width: 5px;
      height: 100px;
    }
    .text-renderer-container.show-scrollbar::-webkit-scrollbar-thumb {
      border-radius: 20px;
    }
    .text-renderer-container.show-scrollbar:hover::-webkit-scrollbar-thumb {
      background-color: var(--affine-black-30);
    }
    .text-renderer-container.show-scrollbar::-webkit-scrollbar-corner {
      display: none;
    }

    .text-renderer-container {
      rich-text .nowrap-lines v-text span,
      rich-text .nowrap-lines v-element span {
        white-space: pre;
      }
      editor-host:focus-visible {
        outline: none;
      }
      editor-host * {
        box-sizing: border-box;
      }
      editor-host {
        isolation: isolate;
      }
    }

    .text-renderer-container[data-app-theme='dark'] {
      .ai-answer-text-editor .affine-page-root-block-container {
        color: ${unsafeCSS(darkCssVariablesV2['--affine-v2-text-primary'])};
      }
    }

    .text-renderer-container[data-app-theme='light'] {
      .ai-answer-text-editor .affine-page-root-block-container {
        color: ${unsafeCSS(lightCssVariablesV2['--affine-v2-text-primary'])};
      }
    }

    ${customHeadingStyles}
  `;

  private _answers: string[] = [];

  private _latestAnswer = '';

  private _lastRenderedAnswer = '';

  private _maxContainerHeight = 0;

  private _renderVersion = 0;

  private _visibleAnswer = '';

  private readonly _clearTimer = () => {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  };

  private _doc: Store | null = null;

  private _host: EditorHost | null = null;

  private readonly _query: Query = {
    mode: 'strict',
    match: [
      'affine:page',
      'affine:note',
      'affine:table',
      'affine:surface',
      'affine:paragraph',
      'affine:callout',
      'affine:code',
      'affine:list',
      'affine:divider',
      'affine:latex',
      'affine:bookmark',
      'affine:attachment',
      'affine:embed-linked-doc',
    ].map(flavour => ({ flavour, viewType: 'display' })),
  };

  private _timer?: ReturnType<typeof setInterval> | null = null;

  private readonly _ensureTimer = () => {
    if (this._timer) return;
    this._timer = setInterval(
      this._tickStreamingAnswer,
      STREAMING_REVEAL_INTERVAL
    );
  };

  private readonly _queueAnswer = (answer = '') => {
    this._latestAnswer = answer;

    if (this.state !== 'generating') {
      this._visibleAnswer = answer;
      this._queueDocRender(answer);
      this._clearTimer();
      return;
    }

    if (!answer.startsWith(this._visibleAnswer)) {
      this._visibleAnswer = '';
    }

    this._ensureTimer();
    this._revealNextAnswerChunk();
  };

  private readonly _queueDocRender = (answer: string) => {
    if (!answer || answer === this._lastRenderedAnswer) return;
    this._lastRenderedAnswer = answer;
    this._answers.push(answer);
  };

  private readonly _revealNextAnswerChunk = (flush = false) => {
    if (!this._latestAnswer.startsWith(this._visibleAnswer)) {
      this._visibleAnswer = '';
    }

    const pendingText = this._latestAnswer.slice(this._visibleAnswer.length);
    const nextChunk = flush
      ? pendingText
      : takeNextStreamingTextReveal(pendingText);

    if (!nextChunk) return false;

    this._visibleAnswer += nextChunk;
    this._queueDocRender(this._visibleAnswer);
    return true;
  };

  private readonly _tickStreamingAnswer = () => {
    if (this.state !== 'generating') {
      this._revealNextAnswerChunk(true);
      this._updateDoc();
      this._clearTimer();
      return;
    }

    if (this._revealNextAnswerChunk()) {
      this._updateDoc();
    }
  };

  private readonly _subscribeDocLinkClicked = () => {
    const refNodeSlots = this._host?.std.getOptional(RefNodeSlotsProvider);
    if (!refNodeSlots) return;
    this.disposables.add(
      refNodeSlots.docLinkClicked
        .pipe(
          filter(
            options => !!this._previewHost && options.host === this._previewHost
          )
        )
        .subscribe(options => {
          // Open the doc in center peek
          this._host?.std
            .getOptional(PeekViewProvider)
            ?.peek({
              docId: options.pageId,
            })
            .catch(console.error);
        })
    );
  };

  private readonly _updateDoc = () => {
    if (this._answers.length > 0) {
      const latestAnswer = this._answers.pop();
      this._answers = [];
      if (latestAnswer) {
        const renderVersion = ++this._renderVersion;
        const middlewares = [
          defaultImageProxyMiddleware,
          codeBlockWrapMiddleware(true),
          ...(this.options.additionalMiddlewares ?? []),
        ];
        markDownToDoc(
          latestAnswer,
          middlewares,
          this.options.affineFeatureFlagService
        )
          .then(doc => {
            if (renderVersion !== this._renderVersion) {
              doc.dispose();
              return;
            }

            this.disposeDoc();
            this._doc = doc.doc.getStore({
              query: this._query,
            });
            this._host = new BlockStdScope({
              store: this._doc,
              extensions:
                this.options.extensions ?? getCustomPageEditorBlockSpecs(),
            }).render();
            this.disposables.add(() => {
              doc.doc.removeStore({ query: this._query });
            });
            this._doc.readonly = true;
            this.requestUpdate();
            if (this.state !== 'generating') {
              this._doc.load();
              const imageProxyService = this._host.std.get(ImageProxyService);
              imageProxyService.setImageProxyURL(
                imageProxyService.imageProxyURL
              );
              this._clearTimer();
            }
          })
          .catch(console.error);
      }
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    this._queueAnswer(this.answer);

    this._updateDoc();
  }

  override firstUpdated() {
    this._subscribeDocLinkClicked();
  }

  private disposeDoc() {
    this._doc?.dispose();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._renderVersion += 1;
    this._clearTimer();
    this.disposeDoc();
  }

  override render() {
    if (!this._doc) {
      return this.state === 'generating'
        ? this._renderGeneratingPulse()
        : nothing;
    }

    const { customHeading, testId = 'ai-text-renderer' } = this.options;
    const classes = classMap({
      'text-renderer-container': true,
      'custom-heading': !!customHeading,
    });
    const theme = this.options.theme?.value;
    return html`
      <div
        class=${classes}
        data-testid=${testId}
        data-app-theme=${theme ?? 'light'}
        data-streaming=${this.state === 'generating'}
      >
        ${keyed(
          this._doc,
          html`<div class="ai-answer-text-editor affine-page-viewport">
            ${this._host}
          </div>`
        )}
        ${this.state === 'generating' ? this._renderGeneratingPulse() : nothing}
      </div>
    `;
  }

  private _renderGeneratingPulse() {
    return html`<div class="generating-pulse" aria-label="AI is generating">
      <span class="generating-pulse-dot"></span>
      <span class="generating-pulse-dot"></span>
      <span class="generating-pulse-dot"></span>
    </div>`;
  }

  override shouldUpdate(changedProperties: PropertyValues) {
    const answerChanged = changedProperties.has('answer');
    const stateChanged = changedProperties.has('state');

    if (answerChanged || stateChanged) {
      this._queueAnswer(this.answer);

      if (this.state !== 'generating') {
        this._revealNextAnswerChunk(true);
        this._updateDoc();
      }
    }

    if (answerChanged && !stateChanged) {
      return false;
    }

    return true;
  }

  override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    requestAnimationFrame(() => {
      if (!this._container) return;
      // Track max height during generation
      if (this.state === 'generating') {
        this._maxContainerHeight = Math.max(
          this._maxContainerHeight,
          this._container.scrollHeight
        );
        // Apply min-height to prevent shrinking
        this._container.style.minHeight = `${this._maxContainerHeight}px`;
      } else {
        setTimeout(() => {
          this._maxContainerHeight = 0;
          this._container.style.minHeight = '';
        }, 500);
      }
    });
  }

  @query('.text-renderer-container')
  private accessor _container!: HTMLDivElement;

  @query('.text-renderer-container editor-host')
  private accessor _previewHost: EditorHost | null = null;

  @property({ attribute: false })
  accessor answer!: string;

  @property({ attribute: false })
  accessor options!: TextRendererOptions;

  @property({ attribute: false })
  accessor state: AffineAIPanelState | undefined = undefined;
}

export const createTextRenderer = (options: TextRendererOptions) => {
  return (answer: string, state?: AffineAIPanelState) => {
    return html`<text-renderer
      contenteditable="false"
      .answer=${answer}
      .state=${state}
      .options=${options}
    ></text-renderer>`;
  };
};

export const LitTextRenderer = createReactComponentFromLit({
  react: React,
  elementClass: TextRenderer,
});

declare global {
  interface HTMLElementTagNameMap {
    'text-renderer': TextRenderer;
  }
}
