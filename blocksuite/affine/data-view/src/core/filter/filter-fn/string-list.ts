import { t } from '../../logical/type-presets.js';
import { createFilter } from './create.js';

export const stringListFilter = [
  createFilter({
    name: 'containsValue',
    self: t.array.instance(t.string.instance()),
    args: [t.string.instance()] as const,
    label: 'Contains value',
    shortString: value => (value ? `: ${value.value}` : undefined),
    impl: (self, value) => Array.isArray(self) && self.includes(value),
  }),
  createFilter({
    name: 'doesNotContainValue',
    self: t.array.instance(t.string.instance()),
    args: [t.string.instance()] as const,
    label: 'Does not contain value',
    shortString: value => (value ? `: Not ${value.value}` : undefined),
    impl: (self, value) => !Array.isArray(self) || !self.includes(value),
  }),
];
