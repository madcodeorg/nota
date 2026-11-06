import { Button } from '@nota/component';
import { SettingRow, SettingWrapper } from '@nota/component/setting-components';
import { useAppUpdater } from '@nota/core/components/hooks/use-app-updater';
import { useState } from 'react';

export const UpdateSettings = () => {
  const {
    checkForUpdates,
    checkingForUpdates,
    updateAvailable,
    updateReady,
    downloadUpdate,
    downloadProgress,
    quitAndInstall,
  } = useAppUpdater();
  const [message, setMessage] = useState('');
  const available = updateAvailable;

  const onCheck = () => {
    setMessage('');
    checkForUpdates()
      .then(result => {
        if (result === null || result === undefined) {
          setMessage('Could not check for updates. Try again later.');
        } else if (result === false) {
          setMessage('Nota is up to date.');
        }
      })
      .catch(() => setMessage('Could not check for updates. Try again later.'));
  };

  // progress starts at 0 before any download, so only count real progress
  const downloading =
    downloadProgress !== null && downloadProgress > 0 && !updateReady;

  return (
    <SettingWrapper title="Updates">
      <SettingRow
        name="Check for updates automatically"
        desc="Nota checks at startup and every 30 minutes. Downloads and installation remain your choice."
      />
      <SettingRow
        name={
          updateReady
            ? `Version ${updateReady.version} is ready`
            : available
              ? `Version ${available.version} is available`
              : 'Check now'
        }
        desc={
          available && !available.allowAutoUpdate
            ? 'Download the new package and install it using your package manager or replace the portable app. Store installations update through the Store.'
            : downloading
              ? `Downloading... ${Math.round(downloadProgress)}%`
              : message
        }
      >
        {updateReady ? (
          <Button variant="primary" onClick={quitAndInstall}>
            Restart to update
          </Button>
        ) : available ? (
          <Button
            variant="primary"
            onClick={downloadUpdate}
            disabled={downloading}
          >
            {available.allowAutoUpdate ? 'Download' : 'Open update downloads'}
          </Button>
        ) : (
          <Button onClick={onCheck} disabled={checkingForUpdates}>
            {checkingForUpdates ? 'Checking...' : 'Check for updates'}
          </Button>
        )}
      </SettingRow>
    </SettingWrapper>
  );
};
