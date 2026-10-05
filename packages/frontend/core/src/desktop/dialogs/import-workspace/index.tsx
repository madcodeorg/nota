import { toast } from '@nota/component';
import {
  type DialogComponentProps,
  type GLOBAL_DIALOG_SCHEMA,
} from '@nota/core/modules/dialogs';
import { WorkspacesService } from '@nota/core/modules/workspace';
import { _addLocalWorkspace } from '@nota/core/modules/workspace-engine';
import { DebugLogger } from '@nota/debug';
import { apis } from '@nota/electron-api';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { useLayoutEffect, useRef } from 'react';

const logger = new DebugLogger('ImportWorkspaceDialog');

export const ImportWorkspaceDialog = ({
  close,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['import-workspace']>) => {
  const effectRef = useRef(false);
  const t = useI18n();
  const workspacesService = useService(WorkspacesService);

  // TODO(@Peng): maybe refactor using xstate?
  useLayoutEffect(() => {
    if (effectRef.current) {
      return;
    }
    effectRef.current = true;

    // a hack for now
    // when adding a workspace, we will immediately let user select a db file
    // after it is done, it will effectively add a new workspace to app-data folder
    // so after that, we will be able to load it via importLocalWorkspace
    (async () => {
      if (!apis) {
        return;
      }
      logger.info('load db file');
      const result = await apis.dialog.loadDBFile();
      if (result.workspaceId) {
        _addLocalWorkspace(result.workspaceId);
        workspacesService.list.revalidate();
        close({
          workspace: {
            flavour: 'local',
            id: result.workspaceId,
          },
        });
      } else if (result.error || result.canceled) {
        if (result.error) {
          toast(t[result.error]());
        }
        close();
      }
    })().catch(err => {
      console.error(err);
    });
  }, [close, t, workspacesService]);

  return null;
};
