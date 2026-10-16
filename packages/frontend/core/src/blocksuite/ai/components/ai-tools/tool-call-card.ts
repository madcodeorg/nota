import { WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import { ShadowlessElement } from '@blocksuite/affine/std';
import { ToolIcon } from '@blocksuite/icons/lit';
import { css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

export class ToolCallCard extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .ai-tool-call-wrapper {
      margin: 2px 0;

      .ai-tool-header {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ai-icon {
        display: flex;
        flex-shrink: 0;
        width: 14px;
        height: 14px;

        svg {
          width: 14px;
          height: 14px;
          color: ${unsafeCSSVarV2('text/secondary')};
        }
      }

      .ai-tool-name {
        font-size: 12px;
        font-weight: 400;
        line-height: 20px;
        margin-left: 0px;
        margin-right: auto;
        color: ${unsafeCSSVarV2('text/secondary')};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .loading-dots {
        display: inline;
        margin-left: 2px;
      }

      .ai-spinner {
        flex-shrink: 0;
        box-sizing: border-box;
        width: 12px;
        height: 12px;
        margin: 1px;
        border-radius: 50%;
        border: 1.5px solid ${unsafeCSSVarV2('layer/insideBorder/border')};
        border-top-color: ${unsafeCSSVarV2('icon/activated')};
        animation: ai-tool-spin 0.8s linear infinite;
      }
    }

    @keyframes ai-tool-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  @property({ attribute: false })
  accessor name: string = 'Tool calling';

  @property({ attribute: false })
  accessor icon: TemplateResult<1> = ToolIcon();

  @state()
  private accessor dotsText = '.';

  private animationTimer?: number;

  override connectedCallback() {
    super.connectedCallback();
    this.startDotsAnimation();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopDotsAnimation();
  }

  private startDotsAnimation() {
    let dotCount = 1;
    this.animationTimer = window.setInterval(() => {
      dotCount = (dotCount % 3) + 1;
      this.dotsText = '.'.repeat(dotCount);
    }, 750);
  }

  private stopDotsAnimation() {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = undefined;
    }
  }

  protected override render() {
    return html`
      <div class="ai-tool-call-wrapper">
        <div class="ai-tool-header">
          <div class="ai-spinner" aria-hidden="true"></div>
          <div class="ai-tool-name">
            ${this.name}<span class="loading-dots">${this.dotsText}</span>
          </div>
        </div>
      </div>
    `;
  }
}
