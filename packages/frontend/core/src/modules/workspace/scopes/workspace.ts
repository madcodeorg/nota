import { Scope } from '@nota/infra';
import type { WorkerInitOptions } from '@nota/nbstore/worker/client';

import type { WorkspaceOpenOptions } from '../open-options';

export class WorkspaceScope extends Scope<{
  openOptions: WorkspaceOpenOptions;
  engineWorkerInitOptions: WorkerInitOptions;
}> {}
