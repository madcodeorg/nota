import { LiveData, Service } from '@nota/infra';

import { CalendarIntegration } from '../entities/calendar';
import { ReadwiseIntegration } from '../entities/readwise';
import { IntegrationWriter } from '../entities/writer';

export class IntegrationService extends Service {
  writer = this.framework.createEntity(IntegrationWriter);
  readwise = this.framework.createEntity(ReadwiseIntegration, {
    writer: this.writer,
  });
  calendar = this.framework.createEntity(CalendarIntegration);

  constructor() {
    super();
  }

  importing$ = LiveData.computed(get => {
    return get(this.readwise.importing$);
  });
}
