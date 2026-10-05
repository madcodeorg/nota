import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine/components/context-menu';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import {
  AiOutlineIcon,
  ArrowDownSmallIcon,
  DoneIcon,
  SearchIcon,
  ThinkingIcon,
} from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { autoPlacement, offset, shift } from '@floating-ui/dom';
import type {
  AIReasoningLevel,
  AIToolsConfigService,
} from '@nota/core/modules/ai-button';
import {
  reasoningLevelsForModel,
  supportsReasoningLevelSelection,
} from '@nota/core/modules/ai-button/reasoning';
import type { AIModelService } from '@nota/core/modules/ai-button/services/models';
import type { CopilotChatHistoryFragment } from '@nota/graphql';
import { computed } from '@preact/signals-core';
import { css, html } from 'lit';
import { property } from 'lit/decorators.js';

const modelSubMenuMiddleware = [
  autoPlacement({ allowedPlacements: ['right-start', 'left-start'] }),
  offset({ mainAxis: 4, crossAxis: 0 }),
  shift({ crossAxis: true, padding: 8 }),
];

const reasoningLevelOptions: Array<{
  label: string;
  level: AIReasoningLevel;
}> = [
  { label: 'Off', level: 'none' },
  { label: 'Minimal', level: 'minimal' },
  { label: 'Low', level: 'low' },
  { label: 'Medium', level: 'medium' },
  { label: 'High', level: 'high' },
  { label: 'Extra high', level: 'xhigh' },
];

export class ChatInputPreference extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    .chat-input-preference-trigger {
      display: flex;
      align-items: center;
      padding: 0px 4px;
      color: var(--affine-v2-icon-primary);
      transition: all 0.23s ease;
      border-radius: 4px;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .chat-input-preference-trigger:hover {
      background-color: var(--affine-v2-layer-background-hoverOverlay);
    }
    .chat-input-preference-trigger-label {
      font-size: 14px;
      line-height: 22px;
      font-weight: 500;
      padding: 0px 4px;
    }
    .chat-input-preference-trigger-icon {
      font-size: 20px;
      line-height: 0;
    }
    .preference-action {
      white-space: nowrap;
      min-width: 220px;
    }
    .ai-active-model-name {
      font-size: 14px;
      color: ${unsafeCSSVarV2('text/secondary')};
      line-height: 22px;
      margin-left: 40px;
    }
    .ai-model-prefix {
      width: 20px;
      height: 20px;
    }
    .ai-model-prefix svg {
      color: ${unsafeCSSVarV2('icon/activated')};
    }
    .ai-model-postfix svg:hover {
      color: ${unsafeCSSVarV2('icon/activated')};
    }
    .ai-model-version {
      font-size: 12px;
      color: ${unsafeCSSVarV2('text/tertiary')};
      line-height: 20px;
      margin-right: 40px;
    }
    .ai-active-reasoning-level {
      font-size: 12px;
      color: ${unsafeCSSVarV2('text/tertiary')};
      margin-left: 24px;
    }
  `;

  @property({ attribute: false })
  accessor session!: CopilotChatHistoryFragment | null | undefined;
  // --------- model props end ---------

  // --------- extended thinking props start ---------
  @property({ attribute: false })
  accessor extendedThinking: boolean = false;

  @property({ attribute: false })
  accessor onExtendedThinkingChange:
    | ((extendedThinking: boolean) => void)
    | undefined;

  @property({ attribute: false })
  accessor reasoningLevel: AIReasoningLevel | undefined;

  @property({ attribute: false })
  accessor onReasoningLevelChange:
    | ((reasoningLevel: AIReasoningLevel) => void)
    | undefined;

  // --------- extended thinking props end ---------

  @property({ attribute: false })
  accessor toolsConfigService!: AIToolsConfigService;

  @property({ attribute: false })
  accessor aiModelService!: AIModelService;

  model = computed(() => {
    const modelId = this.aiModelService.modelId.value;
    const activeModel = this.aiModelService.models.value.find(
      model => model.id === modelId
    );
    const defaultModel = this.aiModelService.models.value.find(
      model => model.isDefault
    );
    return activeModel || defaultModel;
  });

  private get activeReasoningLevel(): AIReasoningLevel {
    const requested =
      this.reasoningLevel ?? (this.extendedThinking ? 'high' : 'none');
    return this.supportedReasoningLevels.includes(requested)
      ? requested
      : 'none';
  }

  private get supportedReasoningLevels() {
    return reasoningLevelsForModel(
      this.model.value?.id,
      this.model.value?.reasoningLevels
    );
  }

  private readonly selectReasoningLevel = (level: AIReasoningLevel) => {
    if (this.onReasoningLevelChange) {
      this.onReasoningLevelChange(level);
      return;
    }
    this.onExtendedThinkingChange?.(level !== 'none');
  };

  openPreference(e: Event) {
    const element = e.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    const modelItems = [];
    const searchItems = [];

    // model switch
    modelItems.push(
      menu.subMenu({
        name: 'Model',
        prefix: AiOutlineIcon(),
        middleware: modelSubMenuMiddleware,
        postfix: html`
          <span class="ai-active-model-name"> ${this.model.value?.name} </span>
        `,
        options: {
          items: this.aiModelService.models.value.map(model => {
            const isSelected = model.id === this.model.value?.id;
            return menu.action({
              name: model.category,
              info: html`
                <span class="ai-model-version">${model.version}</span>
              `,
              prefix: html`
                <div class="ai-model-prefix">
                  ${isSelected ? DoneIcon() : undefined}
                </div>
              `,
              select: () => {
                this.aiModelService.setModel(model.id);
                if (
                  reasoningLevelsForModel(model.id, model.reasoningLevels)
                    .length === 1
                ) {
                  this.selectReasoningLevel('none');
                }
              },
            });
          }),
        },
      })
    );

    if (
      supportsReasoningLevelSelection(
        this.model.value?.id,
        this.model.value?.reasoningLevels
      )
    ) {
      const activeReasoningLabel =
        reasoningLevelOptions.find(
          option => option.level === this.activeReasoningLevel
        )?.label ?? 'Off';
      modelItems.push(
        menu.subMenu({
          name: 'Thinking level',
          prefix: ThinkingIcon(),
          middleware: modelSubMenuMiddleware,
          postfix: html`
            <span class="ai-active-reasoning-level">
              ${activeReasoningLabel}
            </span>
          `,
          options: {
            items: reasoningLevelOptions
              .filter(option =>
                this.supportedReasoningLevels.includes(option.level)
              )
              .map(option =>
                menu.action({
                  name: option.label,
                  prefix:
                    option.level === this.activeReasoningLevel
                      ? DoneIcon()
                      : undefined,
                  select: () => this.selectReasoningLevel(option.level),
                })
              ),
          },
        })
      );
    }

    searchItems.push(
      menu.toggleSwitch({
        name: 'Search workspace notes',
        prefix: SearchIcon(),
        on:
          !!this.toolsConfigService.config.value.searchWorkspace &&
          !!this.toolsConfigService.config.value.readingDocs,
        onChange: (value: boolean) =>
          this.toolsConfigService.setConfig({
            searchWorkspace: value,
            readingDocs: value,
          }),
        class: { 'preference-action': true },
      })
    );

    popMenu(popupTargetFromElement(element), {
      options: {
        items: [
          menu.group({
            items: [...modelItems],
          }),
          menu.group({
            items: [...searchItems],
          }),
        ],
        testId: 'chat-input-preference',
      },
    });
  }

  override render() {
    return html`<button
      type="button"
      @click=${this.openPreference}
      aria-haspopup="menu"
      aria-label="AI model and response settings"
      title="Choose model, thinking level, and workspace search"
      data-testid="chat-input-preference-trigger"
      class="chat-input-preference-trigger"
    >
      <span class="chat-input-preference-trigger-label">
        ${this.model.value?.category ?? 'Model'}
      </span>
      <span class="chat-input-preference-trigger-icon">
        ${ArrowDownSmallIcon()}
      </span>
    </button>`;
  }
}
