import { ToolbarMoreMenuConfigExtension } from '@blocksuite/affine/components/toolbar';
import { EditorSettingExtension } from '@blocksuite/affine/shared/services';
import type { ExtensionType } from '@blocksuite/store';
import {
  createCustomToolbarExtension,
  createToolbarMoreMenuConfig,
} from '@nota/core/blocksuite/view-extensions/editor-config/toolbar';
import { WorkspaceServerService } from '@nota/core/modules/cloud';
import { EditorSettingService } from '@nota/core/modules/editor-setting';
import type { FrameworkProvider } from '@nota/infra';

export function getEditorConfigExtension(
  framework: FrameworkProvider
): ExtensionType[] {
  const editorSettingService = framework.get(EditorSettingService);
  const workspaceServerService = framework.get(WorkspaceServerService);
  const baseUrl = workspaceServerService.server?.baseUrl ?? location.origin;

  return [
    EditorSettingExtension({
      // eslint-disable-next-line rxjs/finnish
      setting$: editorSettingService.editorSetting.settingSignal,
      set: (k, v) => editorSettingService.editorSetting.set(k, v),
    }),
    ToolbarMoreMenuConfigExtension(createToolbarMoreMenuConfig(framework)),

    createCustomToolbarExtension(editorSettingService.editorSetting, baseUrl),
  ].flat();
}
