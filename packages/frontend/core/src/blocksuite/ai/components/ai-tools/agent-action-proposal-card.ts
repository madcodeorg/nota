import { ShadowlessElement } from '@blocksuite/affine/std';
import { css, html, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';

import {
  type ActionProposalScope,
  getScopedActionProposal,
} from '../../agent/action-proposal-client';
import {
  canUndoAppliedProposal,
  proposalPreview,
  proposalTitle,
  type StoredActionProposal,
} from '../../agent/action-proposals';
import type { StreamObject } from '../ai-chat-messages';

export type AgentActionProposalHandler = (
  proposal: StoredActionProposal,
  scope?: ActionProposalScope | null
) => Promise<StoredActionProposal | void>;

function isActionProposalStatus(
  value: unknown
): value is StoredActionProposal['status'] {
  return (
    value === 'pending_approval' ||
    value === 'approved' ||
    value === 'applying' ||
    value === 'undoing' ||
    value === 'failed' ||
    value === 'rejected' ||
    value === 'applied' ||
    value === 'undone'
  );
}

function isStoredActionProposal(value: unknown): value is StoredActionProposal {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    !!record.id &&
    isActionProposalStatus(record.status) &&
    !!record.proposal &&
    typeof record.proposal === 'object'
  );
}

function readStoredActionProposal(data: StreamObject | null | undefined) {
  if (!data || data.type !== 'tool-result') {
    return null;
  }
  const result = data.result;
  if (!result || typeof result !== 'object') {
    return null;
  }
  const proposal = (result as { proposal?: unknown }).proposal;
  return isStoredActionProposal(proposal) ? proposal : null;
}

export class AgentActionProposalCard extends ShadowlessElement {
  static override styles = css`
    .agent-action-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 10px 0;
      padding: 12px;
      border: 1px solid var(--affine-border-color);
      border-radius: 8px;
      background: var(--affine-background-secondary-color);
      color: var(--affine-text-primary-color);
    }

    .agent-action-card[data-status='applied'],
    .agent-action-card[data-status='undone'],
    .agent-action-card[data-status='rejected'] {
      opacity: 0.72;
    }

    .agent-action-error {
      color: var(--affine-error-color);
      font-size: var(--affine-font-xs);
      line-height: 18px;
    }

    .agent-action-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .agent-action-eyebrow {
      color: var(--affine-text-secondary-color);
      font-size: var(--affine-font-xs);
      font-weight: 600;
      text-transform: uppercase;
    }

    .agent-action-status {
      color: var(--affine-text-secondary-color);
      font-size: var(--affine-font-xs);
      white-space: nowrap;
    }

    .agent-action-title {
      color: var(--affine-text-primary-color);
      font-size: var(--affine-font-sm);
      font-weight: 600;
      line-height: 20px;
      overflow-wrap: anywhere;
    }

    .agent-action-reason {
      color: var(--affine-text-secondary-color);
      font-size: var(--affine-font-xs);
      line-height: 18px;
    }

    .agent-action-preview {
      max-height: 180px;
      margin: 0;
      padding: 10px;
      overflow: auto;
      border-radius: 6px;
      background: var(--affine-background-primary-color);
      color: var(--affine-text-secondary-color);
      font-family: var(--affine-font-mono-family);
      font-size: var(--affine-font-xs);
      line-height: 18px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .agent-action-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .agent-action-note {
      margin-right: auto;
      color: var(--affine-text-secondary-color);
      font-size: var(--affine-font-xs);
      line-height: 18px;
    }

    .agent-action-button {
      height: 30px;
      padding: 0 12px;
      border-radius: 6px;
      border: 1px solid var(--affine-border-color);
      background: var(--affine-background-primary-color);
      color: var(--affine-text-primary-color);
      font-size: var(--affine-font-xs);
      cursor: pointer;
    }

    .agent-action-button[data-primary='true'] {
      border-color: transparent;
      background: var(--affine-primary-color);
      color: var(--affine-pure-white);
    }

    .agent-action-button:disabled {
      cursor: not-allowed;
      opacity: 0.54;
    }

    .agent-action-button:focus-visible {
      outline: 2px solid var(--affine-primary-color);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false })
  accessor data: StreamObject | null = null;

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

  @state()
  private accessor stored: StoredActionProposal | null = null;

  @state()
  private accessor localBusy = false;

  private applyingRefreshTimer: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.syncStoredProposal();
    this.scheduleApplyingRefresh();
  }

  override disconnectedCallback() {
    this.clearApplyingRefresh();
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has('data')) {
      this.syncStoredProposal();
    }
    if (changed.has('data') || changed.has('actionProposalScope')) {
      this.refreshStoredProposal().catch(console.error);
    }
    if (changed.has('data') || changed.has('actionProposalScope')) {
      this.scheduleApplyingRefresh();
    }
  }

  private clearApplyingRefresh() {
    if (this.applyingRefreshTimer !== null) {
      window.clearTimeout(this.applyingRefreshTimer);
      this.applyingRefreshTimer = null;
    }
  }

  private scheduleApplyingRefresh() {
    this.clearApplyingRefresh();
    if (
      !this.isConnected ||
      (this.stored?.status !== 'applying' &&
        this.stored?.status !== 'undoing') ||
      !this.actionProposalScope
    ) {
      return;
    }
    this.applyingRefreshTimer = window.setTimeout(() => {
      this.applyingRefreshTimer = null;
      this.refreshStoredProposal()
        .catch(console.error)
        .finally(() => this.scheduleApplyingRefresh());
    }, 5000);
  }

  private syncStoredProposal() {
    this.stored = readStoredActionProposal(this.data);
  }

  private async refreshStoredProposal() {
    const stored = this.stored;
    const scope = this.actionProposalScope;
    if (!stored || !scope) {
      return;
    }
    const proposal = await getScopedActionProposal(stored, scope);
    if (
      proposal.id === stored.id &&
      (!this.stored || proposal.updatedAt >= this.stored.updatedAt)
    ) {
      this.stored = proposal;
      this.scheduleApplyingRefresh();
    }
  }

  private get isWorking() {
    return (
      this.localBusy ||
      (!!this.stored && this.applyingProposalId === this.stored.id)
    );
  }

  private async run(handler: AgentActionProposalHandler | undefined) {
    if (!handler || !this.stored || this.isWorking) {
      return;
    }
    this.localBusy = true;
    try {
      const updated = await handler(this.stored, this.actionProposalScope);
      if (updated) {
        this.stored = updated;
      } else {
        await this.refreshStoredProposal();
      }
    } finally {
      this.localBusy = false;
    }
  }

  private readonly onApply = () => {
    this.run(this.onApplyActionProposal).catch(console.error);
  };

  private readonly onReject = () => {
    this.run(this.onRejectActionProposal).catch(console.error);
  };

  private readonly onUndo = () => {
    this.run(this.onUndoActionProposal).catch(console.error);
  };

  private renderActions(stored: StoredActionProposal) {
    const retryable =
      stored.status === 'failed' && stored.result?.retryable === true;
    const clearDisabled = stored.proposal.type === 'clear_doc';
    const applicable =
      !clearDisabled &&
      (stored.status === 'pending_approval' ||
        stored.status === 'approved' ||
        retryable);
    const rejectable =
      stored.status === 'pending_approval' ||
      stored.status === 'approved' ||
      stored.status === 'failed';
    const undoable = canUndoAppliedProposal(stored);
    const working = this.isWorking;

    if (undoable) {
      return html`
        <button
          class="agent-action-button"
          type="button"
          title="Undo only the change created by this proposal"
          ?disabled=${working || !this.onUndoActionProposal}
          @click=${this.onUndo}
        >
          ${working ? 'Undoing…' : 'Undo'}
        </button>
      `;
    }

    if (!rejectable) {
      return html`<span class="agent-action-note"
        >This action is ${stored.status.replace(/_/g, ' ')}.</span
      >`;
    }

    return html`
      ${clearDisabled
        ? html`<span class="agent-action-note"
            >Whole-note clearing is disabled until it can be undone
            safely.</span
          >`
        : stored.status === 'failed' && !retryable
          ? html`<span class="agent-action-note"
              >Review the target before taking another action. Dismissing this
              proposal does not undo changes.</span
            >`
          : nothing}
      <button
        class="agent-action-button"
        type="button"
        title=${stored.status === 'failed'
          ? 'Dismiss this proposal without changing existing content'
          : 'Reject this proposal without applying it'}
        ?disabled=${working || !this.onRejectActionProposal}
        @click=${this.onReject}
      >
        ${stored.status === 'failed' ? 'Dismiss' : 'Reject'}
      </button>
      ${applicable
        ? html`<button
            class="agent-action-button"
            data-primary="true"
            type="button"
            ?disabled=${working || !this.onApplyActionProposal}
            @click=${this.onApply}
          >
            ${working
              ? 'Applying…'
              : stored.status === 'approved'
                ? 'Resume apply'
                : retryable
                  ? 'Retry'
                  : 'Apply'}
          </button>`
        : nothing}
    `;
  }

  protected override render() {
    const stored = this.stored;
    if (!stored) {
      return nothing;
    }

    return html`
      <div
        class="agent-action-card"
        data-status=${stored.status}
        aria-busy=${this.isWorking}
        aria-label="Nota AI action proposal: ${proposalTitle(stored.proposal)}"
        role="region"
      >
        <div class="agent-action-header">
          <span class="agent-action-eyebrow"
            >${stored.proposal.type.replace(/_/g, ' ')}</span
          >
          <span class="agent-action-status" role="status" aria-live="polite"
            >${stored.status.replace(/_/g, ' ')}</span
          >
        </div>
        <div class="agent-action-title">${proposalTitle(stored.proposal)}</div>
        ${stored.reason
          ? html`<div class="agent-action-reason">${stored.reason}</div>`
          : nothing}
        ${stored.status === 'failed' && typeof stored.result?.error === 'string'
          ? html`<div class="agent-action-error" role="alert">
              ${stored.result.error}
            </div>`
          : nothing}
        <pre class="agent-action-preview" aria-label="Proposed change preview">
${proposalPreview(stored.proposal).slice(0, 900)}</pre
        >
        <div class="agent-action-footer" aria-live="polite">
          ${this.renderActions(stored)}
        </div>
      </div>
    `;
  }
}
