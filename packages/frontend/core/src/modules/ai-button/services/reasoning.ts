import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/affine/shared/utils';
import { LiveData, Service } from '@nota/infra';
import { computed, type ReadonlySignal } from '@preact/signals-core';

import type { GlobalStateService } from '../../storage';
import {
  type AIReasoningLevel,
  type LegacyAIReasoningPreference,
  normalizeAIReasoningLevel,
} from '../reasoning';

const AI_REASONING_KEY = 'AIReasoning';

export class AIReasoningService extends Service {
  constructor(private readonly globalStateService: GlobalStateService) {
    super();

    const { signal: preference, cleanup } = createSignalFromObservable<
      LegacyAIReasoningPreference | undefined
    >(this._preference$, undefined);
    this.preference = preference;
    this.level = computed(() =>
      normalizeAIReasoningLevel(this.preference.value)
    );
    this.enabled = computed(() => this.level.value !== 'none');
    this.disposables.push(cleanup);
  }

  enabled: ReadonlySignal<boolean>;

  level: ReadonlySignal<AIReasoningLevel>;

  private readonly preference: Signal<LegacyAIReasoningPreference | undefined>;

  private readonly _preference$ = LiveData.from(
    this.globalStateService.globalState.watch<LegacyAIReasoningPreference>(
      AI_REASONING_KEY
    ),
    undefined as LegacyAIReasoningPreference | undefined
  );

  setEnabled = (enabled: boolean) => {
    this.setLevel(enabled ? 'high' : 'none');
  };

  setLevel = (level: AIReasoningLevel) => {
    this.globalStateService.globalState.set(AI_REASONING_KEY, level);
  };
}
