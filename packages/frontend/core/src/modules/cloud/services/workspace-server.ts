import { LiveData, Service } from '@nota/infra';

import type { Server } from '../entities/server';

export class WorkspaceServerService extends Service {
  readonly server$ = new LiveData<Server | null>(null);

  get server() {
    return this.server$.value;
  }

  bindServer(server: Server) {
    this.server$.setValue(server);
  }
}
