import { nanoid } from '@blocksuite/store';
import { cssVarV2 } from '@toeverything/theme/v2';
import zod from 'zod';

import { getTagColor } from '../../core/component/tags/colors.js';
import { type SelectTag, SelectTagSchema, t } from '../../core/index.js';
import { propertyType } from '../../core/property/property-config.js';

export const statusGroups = [
  { id: 'todo', name: 'To do' },
  { id: 'inProgress', name: 'In progress' },
  { id: 'complete', name: 'Complete' },
] as const;
export type StatusGroupId = (typeof statusGroups)[number]['id'];

export const StatusOptionSchema = SelectTagSchema.extend({
  group: zod.enum(['todo', 'inProgress', 'complete']),
});
export type StatusOption = zod.infer<typeof StatusOptionSchema>;
export const StatusPropertySchema = zod.object({
  options: zod.array(StatusOptionSchema),
});
export type StatusPropertyData = zod.infer<typeof StatusPropertySchema>;

const isStatusGroupId = (value: unknown): value is StatusGroupId =>
  statusGroups.some(group => group.id === value);

export const statusGroupOf = (option: { group?: unknown }): StatusGroupId =>
  isStatusGroupId(option.group) ? option.group : 'todo';

/** Options ordered by group, then by their stored order inside the group. */
export const sortStatusOptions = <T extends { group?: unknown }>(
  options: T[]
): T[] =>
  statusGroups.flatMap(group =>
    options.filter(option => statusGroupOf(option) === group.id)
  );

export const guessStatusGroup = (name: string): StatusGroupId => {
  const text = name.trim().toLowerCase();
  if (/^(done|complete|completed|finished|closed|resolved)$/.test(text)) {
    return 'complete';
  }
  if (/^(in[ -]?progress|doing|started|active|in review|review)$/.test(text)) {
    return 'inProgress';
  }
  return 'todo';
};

export const createStatusOption = (
  value: string,
  group: StatusGroupId = guessStatusGroup(value),
  color: string = getTagColor()
): StatusOption => ({ id: nanoid(), value, color, group });

/** Keeps names and colors; a property without options gets the default ones. */
export const toStatusOptions = (options: SelectTag[]): StatusOption[] =>
  options.length
    ? options.map(({ id, value, color }) => ({
        id,
        value,
        color,
        group: guessStatusGroup(value),
      }))
    : defaultStatusOptions();

export const toSelectOptions = (options: StatusOption[]): SelectTag[] =>
  sortStatusOptions(options).map(({ id, value, color }) => ({
    id,
    value,
    color,
  }));

export const defaultStatusOptions = (): StatusOption[] => [
  createStatusOption('Not started', 'todo', cssVarV2('chip/label/grey')),
  createStatusOption('In progress', 'inProgress', cssVarV2('chip/label/blue')),
  createStatusOption('Done', 'complete', cssVarV2('chip/label/green')),
];

/** Find an option by name, adding it to `options` when it does not exist yet. */
export const statusOptionIdByName = (
  options: StatusOption[],
  name: string
): string | null => {
  const value = name.trim();
  if (!value) return null;
  let option = options.find(v => v.value === value);
  if (!option) {
    option = createStatusOption(value);
    options.push(option);
  }
  return option.id;
};

export const statusPropertyType = propertyType('status');
export const statusPropertyModelConfig = statusPropertyType.modelConfig({
  name: 'Status',
  kanbanGroup: {
    enabled: true,
    mutable: true,
  },
  propertyData: {
    schema: StatusPropertySchema,
    default: () => ({
      options: defaultStatusOptions(),
    }),
  },
  jsonValue: {
    schema: zod.string().nullable(),
    isEmpty: ({ value }) => value == null,
    type: ({ data }) => t.tag.instance(sortStatusOptions(data.options ?? [])),
  },
  rawValue: {
    schema: zod.string().nullable(),
    default: () => null,
    toString: ({ value, data }) =>
      data.options.find(v => v.id === value)?.value ?? '',
    fromString: ({ value, data }) => ({
      value: statusOptionIdByName(data.options, value),
      data,
    }),
    toJson: ({ value }) => value,
    fromJson: ({ value }) => value,
  },
  addGroup: ({ text, oldData }) => ({
    options: [...(oldData.options ?? []), createStatusOption(text, 'todo')],
  }),
});
