import { Subject } from 'rxjs';

export interface OpenMeetingsPageIntent {
  start?: boolean;
  stop?: boolean;
}

export type NewPageAction = 'page' | 'edgeless' | 'default';

export const applicationMenuSubjects = {
  newPageAction$: new Subject<NewPageAction>(),
  openJournal$: new Subject<void>(),
  openMeetingsPage$: new Subject<OpenMeetingsPageIntent>(),
  openInSettingModal$: new Subject<{
    activeTab: string;
    scrollAnchor?: string;
  }>(),
};
