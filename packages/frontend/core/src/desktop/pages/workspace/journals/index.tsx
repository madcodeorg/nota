import { TodayIcon } from '@blocksuite/icons/rc';
import {
  Button,
  WeekDatePicker,
  type WeekDatePickerHandle,
} from '@nota/component';
import { BlocksuiteEditorJournalDocTitleUI } from '@nota/core/blocksuite/block-suite-editor/journal-doc-title';
import { IntegrationService } from '@nota/core/modules/integration';
import {
  JOURNAL_DATE_FORMAT,
  JournalService,
} from '@nota/core/modules/journal';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewService,
  ViewTitle,
  WorkbenchService,
} from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import dayjs from 'dayjs';
import type { Location } from 'history';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AllDocSidebarTabs } from '../layouts/all-doc-sidebar-tabs';
import * as styles from './index.css';

export function getDateFromUrl(location: Location) {
  const searchParams = new URLSearchParams(location.search);
  const date = searchParams.get('date')
    ? dayjs(searchParams.get('date'))
    : dayjs();
  return date.format(JOURNAL_DATE_FORMAT);
}

export const JournalPlaceholder = ({ dateString }: { dateString: string }) => {
  const t = useI18n();
  const [redirecting, setRedirecting] = useState(false);
  const workbench = useService(WorkbenchService).workbench;
  const journalService = useService(JournalService);
  const calendar = useService(IntegrationService).calendar;
  const date = useMemo(() => dayjs(dateString), [dateString]);
  const calendarEvents = useLiveData(
    useMemo(() => calendar.eventsByDate$(date), [calendar, date])
  );
  const workspaceCalendars = useLiveData(calendar.workspaceCalendars$);
  const workspaceCalendarIds = useMemo(
    () => workspaceCalendars.map(calendar => calendar.id).join('|'),
    [workspaceCalendars]
  );

  useEffect(() => {
    let disposed = false;

    const refreshCalendarEvents = async () => {
      await calendar.refreshLocalCalendarStatus().catch(() => undefined);
      await calendar.loadAccountCalendars().catch(() => undefined);
      await calendar.revalidateWorkspaceCalendars().catch(() => undefined);
      if (disposed) return;
      await calendar
        .revalidateEventsRange(date.startOf('month'), date.endOf('month'))
        .catch(() => undefined);
    };

    refreshCalendarEvents().catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [calendar, date, workspaceCalendarIds]);

  const createJournal = useCallback(() => {
    if (redirecting) return;
    setRedirecting(true);
    const doc = journalService.ensureJournalByDate(dateString);
    workbench.openDoc(doc.id, {
      replaceHistory: true,
      at: 'active',
    });
  }, [dateString, journalService, redirecting, workbench]);

  return (
    <div className={styles.body} data-mobile={BUILD_CONFIG.isMobileEdition}>
      <div className={styles.content}>
        <BlocksuiteEditorJournalDocTitleUI
          date={dateString}
          overrideClassName={styles.docTitleContainer}
        />
        <div
          className={styles.placeholder}
          data-has-events={calendarEvents.length > 0}
        >
          <div className={styles.placeholderMain}>
            <div className={styles.placeholderIcon}>
              <TodayIcon />
            </div>
            <div className={styles.placeholderText}>
              {t['com.affine.journal.placeholder.title']()}
            </div>
            <Button
              variant="primary"
              onClick={createJournal}
              data-testid="confirm-create-journal-button"
            >
              {t['com.affine.journal.placeholder.create']()}
            </Button>
          </div>
          {calendarEvents.length ? (
            <div className={styles.placeholderEvents}>
              <div className={styles.placeholderEventsHeader}>
                <span>Meetings on this day</span>
                <span>{calendarEvents.length}</span>
              </div>
              <div className={styles.placeholderEventsList}>
                {calendarEvents.slice(0, 3).map(event => {
                  const joinUrl = event.meetingUrl ?? event.url;
                  return (
                    <div className={styles.placeholderEvent} key={event.id}>
                      <div className={styles.placeholderEventTime}>
                        {event.allDay
                          ? 'All day'
                          : `${event.startAt.format(
                              'HH:mm'
                            )} - ${event.endAt.format('HH:mm')}`}
                      </div>
                      <div className={styles.placeholderEventBody}>
                        <div className={styles.placeholderEventTitle}>
                          {event.title || t['Untitled']()}
                        </div>
                        {event.calendarName ? (
                          <div className={styles.placeholderEventMeta}>
                            {event.calendarName}
                          </div>
                        ) : null}
                        {joinUrl ? (
                          <a
                            className={styles.placeholderEventLink}
                            href={joinUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Join link
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const weekStyle = { maxWidth: 800, width: '100%' };
// this route page acts as a redirector to today's journal
export const JournalsPageWithConfirmation = () => {
  const handleRef = useRef<WeekDatePickerHandle>(null);

  const t = useI18n();
  const journalService = useService(JournalService);
  const workbench = useService(WorkbenchService).workbench;
  const view = useService(ViewService).view;
  const location = useLiveData(view.location$);
  const dateString = getDateFromUrl(location);
  const todayString = dayjs().format(JOURNAL_DATE_FORMAT);
  const isToday = dateString === todayString;

  const [ready, setReady] = useState(false);

  const openJournal = useCallback(
    (date: string) => {
      workbench.open(`/journals?date=${date}`, { at: 'active' });
    },
    [workbench]
  );

  useLayoutEffect(() => {
    // only handle current route
    if (!location.pathname.startsWith('/journals')) return;

    // check if the journal is created
    const docs = journalService.journalsByDate$(dateString).value;
    if (docs.length === 0) {
      setReady(true);
      return;
    }

    // if created, redirect to the journal
    const journal = docs[0];
    workbench.openDoc(journal.id, { replaceHistory: true, at: 'active' });
  }, [dateString, journalService, location.pathname, view, workbench]);

  if (!ready) return null;

  return (
    <>
      <ViewTitle title="" />
      <ViewIcon icon="journal" />
      <ViewHeader>
        <div className={styles.header}>
          <WeekDatePicker
            data-testid="journal-week-picker"
            handleRef={handleRef}
            style={weekStyle}
            value={dateString}
            onChange={openJournal}
          />

          {!isToday ? (
            <Button
              className={styles.todayButton}
              onClick={() => openJournal(todayString)}
            >
              {t['com.affine.today']()}
            </Button>
          ) : null}
        </div>
      </ViewHeader>
      <ViewBody>
        <JournalPlaceholder dateString={dateString} />
      </ViewBody>
      <AllDocSidebarTabs />
    </>
  );
};

export const Component = () => {
  return <JournalsPageWithConfirmation />;
};
