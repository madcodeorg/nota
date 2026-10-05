import { z } from 'zod';

export const CardViewSelectionWithTypeSchema = z.object({
  viewId: z.string(),
  type: z.enum(['calendar', 'gallery']),
  selectionType: z.literal('row'),
  rowId: z.string(),
});

export type CardViewSelectionWithType = z.infer<
  typeof CardViewSelectionWithTypeSchema
>;
