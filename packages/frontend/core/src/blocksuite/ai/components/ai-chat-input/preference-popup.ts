import {
  menu,
  type MenuHandler,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine/components/context-menu';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import {
  ArrowDownSmallIcon,
  SearchIcon,
  SettingsIcon,
  ThinkingIcon,
} from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import type {
  AIReasoningLevel,
  AIToolsConfigService,
} from '@nota/core/modules/ai-button';
import {
  reasoningLevelsForModel,
  supportsReasoningLevelSelection,
} from '@nota/core/modules/ai-button/reasoning';
import {
  type AIModel,
  type AIModelService,
  groupAIModelsByProvider,
} from '@nota/core/modules/ai-button/services/models';
import type { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import type { CopilotChatHistoryFragment } from '@nota/graphql';
import { computed } from '@preact/signals-core';
import { css, html } from 'lit';
import { property } from 'lit/decorators.js';

const reasoningLevelLabels: Record<AIReasoningLevel, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

const modelSearchName = (model: AIModel) =>
  `${model.category} ${model.version}`;

export class ChatInputPreference extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    chat-input-preference {
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
    }
    .chat-input-preference-trigger {
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
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
      padding: 0px 2px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-input-preference-trigger-icon {
      font-size: 20px;
      line-height: 0;
    }
    .chat-input-thinking-trigger .chat-input-preference-trigger-label {
      font-weight: 400;
      color: ${unsafeCSSVarV2('text/secondary')};
    }
    .preference-action {
      white-space: nowrap;
    }
    affine-menu[data-testid='chat-input-model-menu'] .affine-menu-body {
      max-height: min(420px, 60vh);
      overflow-y: auto;
    }
    .ai-model-group-name {
      padding: 6px 4px 2px;
      font-size: 12px;
      line-height: 20px;
      color: ${unsafeCSSVarV2('text/secondary')};
    }
    .ai-model-option.selected {
      color: ${unsafeCSSVarV2('text/emphasis')};
    }
    .ai-model-menu-settings {
      display: flex;
      padding: 2px;
      font-size: 20px;
      color: ${unsafeCSSVarV2('icon/primary')};
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .ai-model-menu-settings:hover {
      background-color: var(--affine-hover-color);
    }
  `;

  @property({ attribute: false })
  accessor session!: CopilotChatHistoryFragment | null | undefined;

  @property({ attribute: false })
  accessor reasoningLevel: AIReasoningLevel | undefined;

  @property({ attribute: false })
  accessor onReasoningLevelChange:
    | ((reasoningLevel: AIReasoningLevel | undefined) => void)
    | undefined;

  @property({ attribute: false })
  accessor toolsConfigService!: AIToolsConfigService;

  @property({ attribute: false })
  accessor aiModelService!: AIModelService;

  @property({ attribute: false })
  accessor affineWorkspaceDialogService: WorkspaceDialogService | undefined;

  model = computed(() => {
    const modelId = this.aiModelService.modelId.value;
    return this.aiModelService.models.value.find(model => model.id === modelId);
  });

  private get supportedReasoningLevels() {
    return reasoningLevelsForModel(
      this.model.value?.id,
      this.model.value?.reasoningLevels
    );
  }

  // A stored level the current model can't use is ignored by the backend,
  // so it is shown as the provider default.
  private get activeReasoningLevel() {
    const level = this.reasoningLevel;
    return level && this.supportedReasoningLevels.includes(level)
      ? level
      : undefined;
  }

  private readonly openThinkingMenu = (e: Event) => {
    const element = e.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    const active = this.activeReasoningLevel;
    const select = (level: AIReasoningLevel | undefined) => () =>
      this.onReasoningLevelChange?.(level);

    popMenu(popupTargetFromElement(element), {
      options: {
        items: [
          menu.group({
            items: [
              menu.action({
                name: 'Default',
                isSelected: !active,
                select: select(undefined),
              }),
            ],
          }),
          menu.group({
            items: this.supportedReasoningLevels.map(level =>
              menu.action({
                name: reasoningLevelLabels[level],
                isSelected: level === active,
                select: select(level),
              })
            ),
          }),
        ],
        testId: 'chat-input-thinking-menu',
      },
    });
  };

  private readonly openModelMenu = (e: Event) => {
    const element = e.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    const selectedId = this.model.value?.id;
    const dialogService = this.affineWorkspaceDialogService;
    let handler: MenuHandler | undefined;

    const modelGroups = groupAIModelsByProvider(
      this.aiModelService.models.value
    ).map(({ provider, models }) =>
      menu.group({
        items: [
          currentMenu =>
            models.some(model => currentMenu.search(modelSearchName(model)))
              ? html`<div class="ai-model-group-name">${provider}</div>`
              : undefined,
          ...models.map(model => {
            const selected = model.id === selectedId;
            return menu.action({
              name: modelSearchName(model),
              label: () =>
                html`<span
                  class=${selected
                    ? 'ai-model-option selected'
                    : 'ai-model-option'}
                  >${model.version}</span
                >`,
              // An empty postfix keeps the right side blank.
              postfix: html``,
              isSelected: selected,
              testId: 'chat-input-model-option',
              select: () => this.aiModelService.setModel(model.id),
            });
          }),
        ],
      })
    );

    handler = popMenu(popupTargetFromElement(element), {
      options: {
        title: {
          text: 'Models',
          postfix: () =>
            dialogService
              ? html`<button
                  type="button"
                  class="ai-model-menu-settings"
                  aria-label="Open AI settings"
                  title="AI settings"
                  @click=${() => {
                    handler?.close();
                    dialogService.open('setting', { activeTab: 'ai' });
                  }}
                >
                  ${SettingsIcon()}
                </button>`
              : html``,
        },
        search: { placeholder: 'Search models' },
        items: [
          ...modelGroups,
          menu.group({
            items: [
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
              }),
            ],
          }),
        ],
        testId: 'chat-input-model-menu',
      },
    });
  };

  override render() {
    const model = this.model.value;
    const active = this.activeReasoningLevel;
    const showThinking = supportsReasoningLevelSelection(
      model?.id,
      model?.reasoningLevels
    );
    const thinkingLabel = active ? reasoningLevelLabels[active] : 'Default';

    return html`${showThinking
        ? html`<button
            type="button"
            @click=${this.openThinkingMenu}
            aria-haspopup="menu"
            aria-label=${`Thinking level: ${thinkingLabel}`}
            title="Thinking level"
            data-testid="chat-input-thinking-trigger"
            class="chat-input-preference-trigger chat-input-thinking-trigger"
          >
            <span class="chat-input-preference-trigger-icon">
              ${ThinkingIcon()}
            </span>
            <span class="chat-input-preference-trigger-label">
              ${thinkingLabel}
            </span>
          </button>`
        : null}
      <button
        type="button"
        @click=${this.openModelMenu}
        aria-haspopup="menu"
        aria-label="Choose AI model"
        title=${model?.name ?? 'Choose model'}
        data-testid="chat-input-preference-trigger"
        class="chat-input-preference-trigger"
      >
        <span class="chat-input-preference-trigger-label">
          ${model?.version ?? 'Model'}
        </span>
        <span class="chat-input-preference-trigger-icon">
          ${ArrowDownSmallIcon()}
        </span>
      </button>`;
  }
}
