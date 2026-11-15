import {
  type SlashMenuActionItem,
  SlashMenuConfigExtension,
} from '@blocksuite/affine/widgets/slash-menu';
import { NotificationIcon } from '@blocksuite/icons/lit';
import { notify } from '@nota/component';
import {
  formatReminderTime,
  REMINDER_QUICK_OPTIONS,
  reminderQuickTime,
  setReminder,
} from '@nota/core/modules/reminders';
import { WorkspaceService } from '@nota/core/modules/workspace';
import type { FrameworkProvider } from '@nota/infra';

/** `/remind` sets a reminder on the block the slash menu was opened in. */
export function patchReminderSlashMenu(framework: FrameworkProvider) {
  return SlashMenuConfigExtension('nota-reminder', {
    items: () => [
      {
        name: 'Remind me',
        description: 'Get a reminder about this block.',
        icon: NotificationIcon(),
        group: '6_Date@4',
        searchAlias: ['reminder', 'alarm'],
        subMenu: REMINDER_QUICK_OPTIONS.map<SlashMenuActionItem>(option => {
          const label = option.label.replace(/^\w/, c => c.toLowerCase());
          return {
            name: `Remind me ${label}`,
            description: formatReminderTime(reminderQuickTime(option.id)),
            icon: NotificationIcon(),
            action: ({ std, model }) => {
              const remindAt = reminderQuickTime(option.id);
              setReminder(
                framework.get(WorkspaceService).workspace,
                { docId: std.store.id, blockId: model.id },
                remindAt
              );
              notify.success({
                title: 'Reminder set',
                message: formatReminderTime(remindAt),
              });
            },
          };
        }),
      },
    ],
  });
}
