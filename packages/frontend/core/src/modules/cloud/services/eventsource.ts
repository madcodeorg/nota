import { Service } from '@nota/infra';

import type { ServerService } from './server';

export class EventSourceService extends Service {
  constructor(private readonly serverService: ServerService) {
    super();
  }

  eventSource = (url: string, eventSourceInitDict?: EventSourceInit) => {
    return new EventSource(
      new URL(url, this.serverService.server.baseUrl),
      eventSourceInitDict
    );
  };
}
