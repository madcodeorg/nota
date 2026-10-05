import { WorkbenchService } from '@nota/core/modules/workbench';
import { useLiveData, useService } from '@nota/infra';
import { useEffect } from 'react';

export const DocumentTitle = () => {
  const workbenchService = useService(WorkbenchService);
  const workbenchView = useLiveData(workbenchService.workbench.activeView$);
  const viewTitle = useLiveData(workbenchView.title$);

  useEffect(() => {
    document.title = viewTitle ? `${viewTitle} · Nota` : 'Nota';

    return () => {
      document.title = 'Nota';
    };
  }, [viewTitle]);

  return null;
};
