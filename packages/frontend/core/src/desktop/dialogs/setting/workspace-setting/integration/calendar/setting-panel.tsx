import { TodayIcon } from '@blocksuite/icons/rc';
import { Button, notify } from '@nota/component';
import { WorkspaceServerService } from '@nota/core/modules/cloud';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import {
  IntegrationService,
  presentLocalCalendarPermission,
} from '@nota/core/modules/integration';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { IntegrationSettingHeader } from '../setting';
import * as styles from './setting-panel.css';
import { SubscriptionSetting } from './subscription-setting';

const isSameSelection = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
};

export const CalendarSettingPanel = () => {
  const t = useI18n();
  const calendar = useService(IntegrationService).calendar;
  const googleAuth = useService(GoogleAuthService);
  const workspaceServerService = useService(WorkspaceServerService);
  const server = useLiveData(workspaceServerService.server$);
  const accounts = useLiveData(calendar.accounts$);
  const accountCalendars = useLiveData(calendar.accountCalendars$);
  const workspaceCalendars = useLiveData(calendar.workspaceCalendars$);
  const localCalendarStatus = useLiveData(calendar.localCalendarStatus$);
  const googleStatus = useLiveData(googleAuth.session.status$);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const reloadCalendars = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      calendar.refreshLocalCalendarStatus(),
      calendar.revalidateWorkspaceCalendars(),
      calendar.loadAccountCalendars(),
    ]);
    const failures = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      .map(result =>
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      );
    setLoadError(failures.join(' '));
    setLoading(false);
  }, [calendar]);

  useEffect(() => {
    let disposed = false;
    let refreshPromise: Promise<void> | null = null;
    const refreshWhenActive = () => {
      if (disposed || document.visibilityState === 'hidden' || refreshPromise) {
        return;
      }
      const refresh = reloadCalendars()
        .catch(error => {
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load calendars.'
          );
          setLoading(false);
        })
        .finally(() => {
          if (refreshPromise === refresh) {
            refreshPromise = null;
          }
        });
      refreshPromise = refresh;
    };

    refreshWhenActive();
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [reloadCalendars, server]);

  useEffect(() => {
    const selected = new Set(
      workspaceCalendars.flatMap(calendar =>
        calendar.items.map(item => item.subscriptionId)
      )
    );
    setSelectedIds(selected);
  }, [workspaceCalendars]);

  const orderedSubscriptions = useMemo(() => {
    return accounts.flatMap(account => accountCalendars.get(account.id) ?? []);
  }, [accounts, accountCalendars]);

  const handleToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const hasChanges = useMemo(() => {
    const saved = new Set(
      workspaceCalendars.flatMap(calendar =>
        calendar.items.map(item => item.subscriptionId)
      )
    );
    return !isSameSelection(saved, selectedIds);
  }, [selectedIds, workspaceCalendars]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const items = orderedSubscriptions
        .filter(subscription => selectedIds.has(subscription.id))
        .map((subscription, index) => ({
          subscriptionId: subscription.id,
          sortOrder: index,
        }));
      await calendar.updateWorkspaceCalendars(items);
    } catch (error) {
      console.error('Failed to save calendar settings', error);
      notify.error({
        title: t['com.affine.integration.calendar.save-error'](),
      });
    } finally {
      setSaving(false);
    }
  }, [calendar, orderedSubscriptions, selectedIds, t]);

  const hasCalendars = orderedSubscriptions.length > 0;
  const localPermission = useMemo(
    () => presentLocalCalendarPermission(localCalendarStatus),
    [localCalendarStatus]
  );

  const handleLocalCalendarAction = useCallback(async () => {
    try {
      if (localPermission.action === 'open-settings') {
        await calendar.openLocalCalendarSettings();
      } else if (
        localPermission.action === 'connect' ||
        localPermission.action === 'request-full-access'
      ) {
        await calendar.requestLocalCalendarAccess();
      }
      await reloadCalendars();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      notify.error({ title: 'Apple Calendar connection failed', message });
    }
  }, [calendar, localPermission.action, reloadCalendars]);

  const handleGoogleConnect = useCallback(async () => {
    try {
      await googleAuth.connect();
      await reloadCalendars();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      notify.error({ title: 'Google Calendar connection failed', message });
    }
  }, [googleAuth, reloadCalendars]);

  const getAccountDisplay = (account: (typeof accounts)[number]) => {
    const title =
      account.displayName && account.displayName !== account.email
        ? account.displayName
        : (account.email ?? account.displayName ?? account.id);
    const caption =
      account.email &&
      account.displayName &&
      account.displayName !== account.email
        ? account.email
        : null;

    return { caption, title };
  };

  return (
    <>
      <IntegrationSettingHeader
        icon={<TodayIcon />}
        name={t['com.affine.integration.calendar.name']()}
        desc={t['com.affine.integration.calendar.desc']()}
        divider={false}
      />
      <div className={styles.list}>
        {accounts.map(account => {
          const calendars = accountCalendars.get(account.id) ?? [];
          if (calendars.length === 0) return null;
          const { caption, title } = getAccountDisplay(account);
          return (
            <section key={account.id} className={styles.group}>
              <div className={styles.groupHeader}>
                <div>
                  <div className={styles.groupTitle}>{title}</div>
                  {caption ? (
                    <div className={styles.groupCaption}>{caption}</div>
                  ) : null}
                </div>
                <div className={styles.groupMeta}>
                  {calendars.length}{' '}
                  {t['com.affine.integration.calendar.name']()}
                </div>
              </div>
              <div className={styles.groupList}>
                {calendars.map(subscription => (
                  <SubscriptionSetting
                    key={subscription.id}
                    subscription={subscription}
                    checked={selectedIds.has(subscription.id)}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {!hasCalendars ? (
          <div className={styles.empty}>
            <strong>No calendars available yet</strong>
            <span>
              Connect Apple Calendar once for on-device access, or use your
              Google account for Google Calendar.
            </span>
            <div className={styles.emptyActions}>
              {localPermission.action ? (
                <Button
                  onClick={() => void handleLocalCalendarAction()}
                  disabled={loading}
                >
                  {localPermission.actionLabel}
                </Button>
              ) : null}
              {googleStatus !== 'connected' ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleGoogleConnect()}
                  disabled={loading || googleStatus === 'connecting'}
                  loading={googleStatus === 'connecting'}
                >
                  Connect Google Calendar
                </Button>
              ) : null}
              {loadError ? (
                <Button
                  variant="secondary"
                  onClick={() => void reloadCalendars()}
                  disabled={loading}
                  loading={loading}
                >
                  Retry
                </Button>
              ) : null}
            </div>
            {loadError ? (
              <span role="alert">Could not refresh calendars: {loadError}</span>
            ) : null}
          </div>
        ) : null}
        {hasCalendars && loadError ? (
          <div className={styles.refreshError} role="alert">
            <span>Some calendars could not refresh: {loadError}</span>
            <Button
              variant="secondary"
              onClick={() => void reloadCalendars()}
              disabled={loading}
              loading={loading}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!hasChanges || saving}
          loading={saving}
        >
          {t['com.affine.editCollection.save']()}
        </Button>
      </div>
    </>
  );
};
