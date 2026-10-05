import { Service } from '@nota/infra';

import type { EditorScope } from '../scopes/editor';

export class EditorService extends Service {
  readonly editor = this.scope.props.editor;

  constructor(readonly scope: EditorScope) {
    super();
  }
}
