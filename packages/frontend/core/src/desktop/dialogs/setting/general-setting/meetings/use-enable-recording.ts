import { useConfirmModal } from '@nota/component';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { MeetingSettingsService } from '@nota/core/modules/media/services/meeting-settings';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import track from '@nota/track';

export const useEnableRecording = () => {
  const meetingSettingsService = useService(MeetingSettingsService);
  const confirmModal = useConfirmModal();
  const t = useI18n();

  const handleEnabledChange = useAsyncCallback(
    async (checked: boolean) => {
      try {
        track.$.settingsPanel.meetings.toggleMeetingFeatureFlag({
          option: checked ? 'on' : 'off',
          type: 'Meeting record',
        });
        await meetingSettingsService.setEnabled(checked);
      } catch {
        confirmModal.openConfirmModal({
          title:
            t['com.affine.settings.meetings.record.permission-modal.title'](),
          description:
            t[
              'com.affine.settings.meetings.record.permission-modal.description'
            ](),
          onConfirm: async () => {
            await meetingSettingsService.showRecordingPermissionSetting(
              'systemAudio'
            );
          },
          cancelText: t['com.affine.recording.dismiss'](),
          confirmButtonOptions: {
            variant: 'primary',
          },
          confirmText:
            t[
              'com.affine.settings.meetings.record.permission-modal.open-setting'
            ](),
        });
      }
    },
    [confirmModal, meetingSettingsService, t]
  );

  return handleEnabledChange;
};
