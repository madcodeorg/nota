import { WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import { ShadowlessElement } from '@blocksuite/affine/std';
import { ToolIcon } from '@blocksuite/icons/lit';
import { css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

export class ToolFailedCard extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .ai-tool-failed-wrapper {
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
          color: ${unsafeCSSVarV2('button/error')};
        }
      }

      .ai-error-name {
        font-size: 12px;
        font-weight: 400;
        line-height: 20px;
        margin-left: 0px;
        margin-right: auto;
        color: ${unsafeCSSVarV2('button/error')};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  `;

  @property({ attribute: false })
  accessor name: string = 'Tool calling failed';

  @property({ attribute: false })
  accessor icon: TemplateResult<1> = ToolIcon();

  protected override render() {
    return html`
      <div class="ai-tool-failed-wrapper">
        <div class="ai-tool-header">
          <div class="ai-icon">${this.icon}</div>
          <div class="ai-error-name">${this.name}</div>
        </div>
      </div>
    `;
  }
}
