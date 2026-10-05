import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { scrollbarStyle } from '@blocksuite/affine/shared/styles';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import { type EditorHost } from '@blocksuite/affine/std';
import { InformationIcon, ToggleDownIcon } from '@blocksuite/icons/lit';
import { signal } from '@preact/signals-core';
import { baseTheme } from '@toeverything/theme';
import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';

import type { AIError } from '../provider';
import { PaymentRequiredError, UnauthorizedError } from '../provider';

export class AIErrorWrapper extends SignalWatcher(WithDisposable(LitElement)) {
  static override styles = css`
    .error-wrapper {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 8px;
      align-self: stretch;
      border-radius: 4px;
      padding: 8px 8px 12px 8px;
      background-color: ${unsafeCSSVarV2('aI/errorBackground')};
      font-family: ${unsafeCSS(baseTheme.fontSansFamily)};

      .content {
        align-items: flex-start;
        display: flex;
        gap: 8px;
        align-self: stretch;
        color: ${unsafeCSSVarV2('aI/errorText')};
        font-feature-settings:
          'clig' off,
          'liga' off;
        /* light/sm */
        font-size: var(--affine-font-sm);
        font-style: normal;
        font-weight: 400;
        line-height: 22px; /* 157.143% */

        .icon svg {
          position: relative;
          top: 3px;
        }
      }

      .text-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .detail-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
      }
      .detail-title {
        display: flex;
        align-items: center;
        width: fit-content;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      .detail-title:hover {
        cursor: pointer;
      }
      .detail-content {
        padding: 8px;
        border-radius: 4px;
        background-color: ${unsafeCSSVarV2('aI/errorDetailBackground')};
        overflow: auto;
      }
      ${scrollbarStyle('.detail-content')}

      .toggle {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .toggle.up svg {
        transform: rotate(180deg);
        transition: all 0.2s ease-in-out;
      }

      .action {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        width: 100%;
      }
      .action-button {
        cursor: pointer;
        color: ${unsafeCSSVarV2('text/primary')};
        background: ${unsafeCSSVarV2('button/secondary')};
        border-radius: 8px;
        border: 1px solid ${unsafeCSSVarV2('button/innerBlackBorder')};
        padding: 4px 12px;
        font-size: var(--affine-font-xs);
        font-style: normal;
        font-weight: 500;
        line-height: 20px;
      }
      .action-button:hover {
        transition: all 0.2s ease-in-out;
        background-image: linear-gradient(
          rgba(0, 0, 0, 0.04),
          rgba(0, 0, 0, 0.04)
        );
      }
      .detail-title:focus-visible,
      .action-button:focus-visible {
        outline: 2px solid ${unsafeCSSVarV2('button/primary')};
        outline-offset: 2px;
      }
    }
  `;

  private readonly _showDetailContent = signal(false);

  protected override render() {
    return html` <div class="error-wrapper" role="alert">
      <div class="content">
        <div class="icon" aria-hidden="true">${InformationIcon()}</div>
        <div class="text-container">
          <div>${this.text}</div>
          ${this.showDetailPanel
            ? html`<div class="detail-container">
                <button
                  type="button"
                  class="detail-title"
                  aria-expanded=${this._showDetailContent.value}
                  @click=${() =>
                    (this._showDetailContent.value =
                      !this._showDetailContent.value)}
                >
                  <span
                    >${this._showDetailContent.value
                      ? 'Hide details'
                      : 'Show details'}</span
                  >
                  <span
                    class="toggle ${this._showDetailContent.value
                      ? 'down'
                      : 'up'}"
                  >
                    ${ToggleDownIcon({ width: '16px', height: '16px' })}
                  </span>
                </button>
                ${this._showDetailContent.value
                  ? html`<div class="detail-content">${this.errorMessage}</div>`
                  : nothing}
              </div>`
            : nothing}
        </div>
      </div>
      ${this.actionText
        ? html`<div class="action">
            <button
              type="button"
              class="action-button"
              @click=${this.onClick}
              data-testid="ai-error-action-button"
            >
              ${this.actionText}
              ${this.actionTooltip
                ? html`<affine-tooltip tip-position="top">
                    ${this.actionTooltip}
                  </affine-tooltip>`
                : nothing}
            </button>
          </div>`
        : nothing}
    </div>`;
  }

  @property({ attribute: false })
  accessor text: string = '';

  @property({ attribute: false })
  accessor onClick: () => void = () => {};

  @property({ attribute: false })
  accessor errorMessage: string = '';

  @property({ attribute: false })
  accessor actionText: string = '';

  @property({ attribute: false })
  accessor actionTooltip: string = '';

  @property({ attribute: false })
  accessor showDetailPanel: boolean = false;

  @property({ attribute: 'data-testid', reflect: true })
  accessor testId = 'ai-error';
}

const ProviderConfigurationErrorRenderer = (
  error: PaymentRequiredError | UnauthorizedError
) => html` <ai-error-wrapper .text=${error.message}></ai-error-wrapper> `;

type ErrorProps = {
  text?: string;
  errorMessage?: string;
  actionText?: string;
  actionTooltip?: string;
};

const generalErrorText = 'AI request failed.';

const GeneralErrorRenderer = (props: ErrorProps = {}) => {
  return html`<ai-error-wrapper
    .text=${props.text ?? generalErrorText}
    .errorMessage=${props.errorMessage ?? ''}
    .showDetailPanel=${!!props.errorMessage}
    .actionText=${props.actionText ?? ''}
    .actionTooltip=${props.actionTooltip ?? ''}
  ></ai-error-wrapper>`;
};

export function AIChatErrorRenderer(error: AIError, _host?: EditorHost | null) {
  if (error instanceof PaymentRequiredError) {
    return ProviderConfigurationErrorRenderer(error);
  } else if (error instanceof UnauthorizedError) {
    return ProviderConfigurationErrorRenderer(error);
  } else {
    return GeneralErrorRenderer({
      errorMessage: error.message,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-error-wrapper': AIErrorWrapper;
  }
}
