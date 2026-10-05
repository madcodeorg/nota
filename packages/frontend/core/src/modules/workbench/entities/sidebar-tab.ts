import { Entity } from '@nota/infra';

export class SidebarTab extends Entity<{ id: string }> {
  readonly id = this.props.id;
}
