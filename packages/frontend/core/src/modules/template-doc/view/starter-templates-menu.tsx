import { TemplateIcon } from '@blocksuite/icons/rc';
import { MenuItem, MenuSub } from '@nota/component';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { useService } from '@nota/infra';

import { DocsService } from '../../doc';
import { WorkbenchService } from '../../workbench';
import {
  createLocalStarter,
  LOCAL_STARTER_TEMPLATES,
  type LocalStarterTemplateId,
} from '../services/starter-templates';

export const StarterTemplatesMenu = ({
  onCreated,
}: {
  onCreated?: () => void;
}) => {
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;
  const create = useAsyncCallback(
    async (id: LocalStarterTemplateId) => {
      const docId = createLocalStarter(docsService, id);
      workbench.openDoc(docId);
      onCreated?.();
    },
    [docsService, workbench, onCreated]
  );

  return (
    <MenuSub
      triggerOptions={{
        prefixIcon: <TemplateIcon />,
        'data-testid': 'local-starter-templates',
      }}
      items={LOCAL_STARTER_TEMPLATES.map(starter => (
        <MenuItem
          key={starter.id}
          data-testid={`local-starter-${starter.id}`}
          onClick={() => create(starter.id)}
        >
          {starter.title}
        </MenuItem>
      ))}
    >
      Starter templates
    </MenuSub>
  );
};
