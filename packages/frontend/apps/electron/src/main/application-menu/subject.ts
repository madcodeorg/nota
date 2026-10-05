import { Subject } from 'rxjs';

export interface OpenMeetingsPageIntent {
  start?: boolean;
  stop?: boolean;
}

export const applicationMenuSubjects = {
  newPageAction$: new Subject<'page' | 'edgeless'>(),
  openJournal$: new Subject<void>(),
  openMeetingsPage$: new Subject<OpenMeetingsPageIntent>(),
  openInSettingModal$: new Subject<{
    activeTab: string;
    scrollAnchor?: string;
  }>(),
};
