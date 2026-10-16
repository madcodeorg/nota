import { WithDisposable } from '@blocksuite/affine/global/lit';
import type { ColorScheme } from '@blocksuite/affine/model';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import {
  type BlockStdScope,
  type EditorHost,
  ShadowlessElement,
} from '@blocksuite/affine/std';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { NotificationService } from '@blocksuite/affine-shared/services';
import { ArrowDownSmallIcon, CopyIcon, DoneIcon } from '@blocksuite/icons/lit';
import type { FeatureFlagService } from '@nota/core/modules/feature-flag';
import type { PeekViewService } from '@nota/core/modules/peek-view';
import type { Signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';

import type { ActionProposalScope } from '../../agent/action-proposal-client';
import { splitNoteDrafts } from '../../utils/note-drafts';
import { formatSourceCitations } from '../../utils/source-citations';
import {
  type AnswerSegment,
  groupToolSteps,
  mergeStreamObjects,
} from '../../utils/stream-objects';
import type { AffineAIPanelState } from '../../widgets/ai-panel/type';
import type { DocDisplayConfig } from '../ai-chat-chips';
import type { StreamObject } from '../ai-chat-messages';
import type { AgentActionProposalHandler } from '../ai-tools/agent-action-proposal-card';
import { notaToolView } from '../ai-tools/nota-tool-view';

// Tools with their own interactive card stay visible instead of collapsing.
const CARD_TOOLS = new Set([
  'doc_compose',
  'code_artifact',
  'doc_edit',
  'section_edit',
]);

function isToolStep(data: StreamObject) {
  if (data.type !== 'tool-call' && data.type !== 'tool-result') return false;
  if (CARD_TOOLS.has(data.toolName)) return false;
  return !(
    data.type === 'tool-result' &&
    data.toolName === 'propose_nota_action' &&
    (data.result as { proposal?: unknown } | null)?.proposal
  );
}

export class ChatContentStreamObjects extends WithDisposable(
  ShadowlessElement
) {
  static override styles = css`
    .reasoning-indicator {
      margin: 2px 0;
      font-size: 12px;
      line-height: 20px;
      color: ${unsafeCSSVarV2('text/tertiary')};
    }

    .tool-steps-summary {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 2px 0;
      padding: 0;
      border: none;
      background: transparent;
      font-size: 12px;
      line-height: 20px;
      color: ${unsafeCSSVarV2('text/tertiary')};
      cursor: pointer;

      svg {
        width: 14px;
        height: 14px;
      }

      .done-icon {
        display: flex;
        color: ${unsafeCSSVarV2('status/success')};
      }

      .chevron {
        display: flex;
        transition: transform 0.2s ease;
      }

      &[aria-expanded='true'] .chevron {
        transform: rotate(180deg);
      }
    }

    .tool-steps-summary:hover {
      color: ${unsafeCSSVarV2('text/secondary')};
    }

    .tool-steps-list {
      margin: 0 0 4px 6px;
      padding-left: 10px;
      border-left: 1px solid ${unsafeCSSVarV2('layer/insideBorder/border')};
    }

    .note-draft {
      margin: 10px 0;
      padding: 8px 14px 6px;
      border-left: 3px solid var(--affine-primary-color);
      border-radius: 0 8px 8px 0;
      background: color-mix(
        in srgb,
        var(--affine-primary-color) 7%,
        transparent
      );
    }

    .note-draft-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .note-draft-label {
      font-size: 11px;
      font-weight: 600;
      line-height: 20px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--affine-primary-color);
    }

    .note-draft-copy {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border: none;
      border-radius: 4px;
      background: transparent;
      font-size: 12px;
      color: ${unsafeCSSVarV2('text/secondary')};
      cursor: pointer;

      svg {
        width: 14px;
        height: 14px;
      }
    }

    .note-draft-copy:hover {
      background: ${unsafeCSSVarV2('layer/background/hoverOverlay')};
      color: ${unsafeCSSVarV2('text/primary')};
    }
  `;

  @state()
  private accessor stepsExpanded = false;

  @property({ attribute: false })
  accessor answer!: StreamObject[];

  @property({ attribute: false })
  accessor host: EditorHost | null | undefined;

  @property({ attribute: false })
  accessor std: BlockStdScope | null | undefined;

  @property({ attribute: false })
  accessor state: AffineAIPanelState = 'finished';

  @property({ attribute: false })
  accessor width: Signal<number | undefined> | undefined;

  @property({ attribute: false })
  accessor extensions!: ExtensionType[];

  @property({ attribute: false })
  accessor affineFeatureFlagService!: FeatureFlagService;

  @property({ attribute: false })
  accessor theme!: Signal<ColorScheme>;

  @property({ attribute: false })
  accessor independentMode: boolean | undefined;

  @property({ attribute: false })
  accessor notificationService!: NotificationService;

  @property({ attribute: false })
  accessor docDisplayService!: DocDisplayConfig;

  @property({ attribute: false })
  accessor peekViewService!: PeekViewService;

  @property({ attribute: false })
  accessor onOpenDoc!: (docId: string, sessionId?: string) => void;

  @property({ attribute: false })
  accessor applyingProposalId: string | null = null;

  @property({ attribute: false })
  accessor actionProposalScope: ActionProposalScope | null = null;

  @property({ attribute: false })
  accessor onApplyActionProposal: AgentActionProposalHandler | undefined;

  @property({ attribute: false })
  accessor onRejectActionProposal: AgentActionProposalHandler | undefined;

  @property({ attribute: false })
  accessor onUndoActionProposal: AgentActionProposalHandler | undefined;

  private renderToolCall(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-call') {
      return nothing;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .doc=${this.host?.store}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-read-result>`;
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      default:
        return this.renderNotaTool(streamObject);
    }
  }

  private readonly docTitle = (docId: string) =>
    this.docDisplayService?.getDocMeta(docId)
      ? this.docDisplayService.getTitle(docId) || undefined
      : undefined;

  private renderNotaTool(
    streamObject: Extract<StreamObject, { type: 'tool-call' | 'tool-result' }>
  ) {
    const view = notaToolView(streamObject, this.docTitle);
    if (streamObject.type === 'tool-call') {
      return html`<tool-call-card
        .name=${view.name}
        .width=${this.width}
      ></tool-call-card>`;
    }
    if (view.failed) {
      return html`<tool-call-failed .name=${view.name}></tool-call-failed>`;
    }
    return html`<tool-result-card
      .name=${view.name}
      .width=${this.width}
      .results=${view.items.map(item => {
        const { docId } = item;
        return {
          title: item.title,
          content: item.content,
          href: item.href,
          onClick: docId ? () => this.onOpenDoc?.(docId) : undefined,
        };
      })}
    ></tool-result-card>`;
  }

  private renderToolResult(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-result') {
      return nothing;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .host=${this.host}
            .renderRichText=${this.renderRichText.bind(this)}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .docDisplayService=${this.docDisplayService}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-read-result>`;
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      case 'propose_nota_action':
        if (!(streamObject.result as { proposal?: unknown } | null)?.proposal) {
          return this.renderNotaTool(streamObject);
        }
        return html`
          <agent-action-proposal-card
            .data=${streamObject}
            .actionProposalScope=${this.actionProposalScope}
            .applyingProposalId=${this.applyingProposalId}
            .onApplyActionProposal=${this.onApplyActionProposal}
            .onRejectActionProposal=${this.onRejectActionProposal}
            .onUndoActionProposal=${this.onUndoActionProposal}
          ></agent-action-proposal-card>
        `;
      default:
        return this.renderNotaTool(streamObject);
    }
  }

  private renderRichText(text: string) {
    return html`<chat-content-rich-text
      .text=${formatSourceCitations(text, this.docDisplayService)}
      .state=${this.state}
      .extensions=${this.extensions}
      .affineFeatureFlagService=${this.affineFeatureFlagService}
      .theme=${this.theme}
    ></chat-content-rich-text>`;
  }

  private copyNoteDraft(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => this.notificationService?.toast('Note draft copied'))
      .catch(console.error);
  }

  private renderMessageText(text: string) {
    return splitNoteDrafts(text).map(part =>
      part.type === 'note'
        ? html`<div class="note-draft">
            <div class="note-draft-header">
              <span class="note-draft-label">Note draft</span>
              <button
                class="note-draft-copy"
                type="button"
                @click=${() => this.copyNoteDraft(part.text)}
              >
                ${CopyIcon()} Copy
              </button>
            </div>
            ${this.renderRichText(part.text)}
          </div>`
        : this.renderRichText(part.text)
    );
  }

  private renderObject(data: StreamObject) {
    switch (data.type) {
      case 'text-delta':
        return this.renderMessageText(data.textDelta);
      case 'tool-call':
        return this.renderToolCall(data);
      case 'tool-result':
        return this.renderToolResult(data);
      default:
        return nothing;
    }
  }

  private renderSegment(segment: AnswerSegment) {
    return segment.kind === 'steps'
      ? segment.items.map(item => this.renderObject(item))
      : this.renderObject(segment.data);
  }

  private renderStepsSummary(steps: AnswerSegment[]) {
    const count = steps.reduce(
      (total, segment) =>
        total + (segment.kind === 'steps' ? segment.items.length : 0),
      0
    );
    const expanded = this.stepsExpanded;
    return html`<button
        class="tool-steps-summary"
        type="button"
        aria-expanded=${expanded}
        @click=${() => (this.stepsExpanded = !expanded)}
      >
        <span class="done-icon">${DoneIcon()}</span>
        Done · ${count} ${count === 1 ? 'step' : 'steps'}
        <span class="chevron">${ArrowDownSmallIcon()}</span>
      </button>
      ${expanded
        ? html`<div class="tool-steps-list">
            ${steps.map(segment => this.renderSegment(segment))}
          </div>`
        : nothing}`;
  }

  protected override render() {
    // Saved history keeps each tool call and its result as separate objects;
    // merge them so a finished tool shows one result card, not a stale
    // in-progress card next to it.
    const objects = mergeStreamObjects(this.answer);
    // Reasoning text stays hidden; only signal that the model is still thinking.
    const thinking =
      this.state === 'generating' && objects.at(-1)?.type === 'reasoning';
    const segments = groupToolSteps(objects, isToolStep);
    const lastSteps = segments.findLastIndex(s => s.kind === 'steps');
    const hasFinalText = segments
      .slice(lastSteps + 1)
      .some(s => s.kind === 'object' && s.data.type === 'text-delta');

    // Once the reply ends, tool steps and the progress messages between them
    // fold into one line so only the final answer stays in view. Cards that
    // need the user (proposals, artifacts) stay visible.
    if (this.state === 'finished' && lastSteps !== -1 && hasFinalText) {
      const work = segments.slice(0, lastSteps + 1);
      const folded = work.filter(
        s => s.kind === 'steps' || s.data.type === 'text-delta'
      );
      const kept = work.filter(s => !folded.includes(s));
      return html`<div>
        ${this.renderStepsSummary(folded)}
        ${kept.map(segment => this.renderSegment(segment))}
        ${segments
          .slice(lastSteps + 1)
          .map(segment => this.renderSegment(segment))}
      </div>`;
    }

    return html`<div>
      ${segments.map(segment => this.renderSegment(segment))}
      ${thinking
        ? html`<div class="reasoning-indicator">Thinking…</div>`
        : nothing}
    </div>`;
  }
}
