import { Scope } from '@nota/infra';

import type { Server } from '../entities/server';

export class ServerScope extends Scope<{ server: Server }> {
  readonly server = this.props.server;
}
