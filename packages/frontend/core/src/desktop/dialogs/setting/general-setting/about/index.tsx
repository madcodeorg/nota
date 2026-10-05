import { OpenInNewIcon } from '@blocksuite/icons/rc';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@nota/component/setting-components';
import { appIconMap, appNames } from '@nota/core/utils/channel';
import { NOTA_LINKS } from '@nota/core/utils/public-links';
import { useI18n } from '@nota/i18n';

import * as styles from './style.css';

export const AboutAffine = () => {
  const t = useI18n();
  const channel = BUILD_CONFIG.appBuildType;
  const appIcon = appIconMap[channel];
  const appName = appNames[channel];

  return (
    <>
      <SettingHeader
        title={t['com.affine.aboutAFFiNE.title']()}
        subtitle={t['com.affine.aboutAFFiNE.subtitle']()}
        data-testid="about-title"
      />
      <SettingWrapper title={t['com.affine.aboutAFFiNE.version.title']()}>
        <SettingRow
          name={appName}
          desc={BUILD_CONFIG.appVersion}
          className={styles.appImageRow}
        >
          <img src={appIcon} alt={appName} width={56} height={56} />
        </SettingRow>
        <SettingRow
          name={t['com.affine.aboutAFFiNE.version.editor.title']()}
          desc={BUILD_CONFIG.editorVersion}
        />
        <SettingRow
          name="Local-first"
          desc="Notes, recordings, transcripts, and AI settings stay in your Nota workspace."
          spreadCol={false}
        />
      </SettingWrapper>
      <SettingWrapper title={t['com.affine.aboutAFFiNE.contact.title']()}>
        <a
          className={styles.link}
          rel="noreferrer"
          href={NOTA_LINKS.source}
          target="_blank"
        >
          {t['com.affine.aboutAFFiNE.contact.website']()}
          <OpenInNewIcon className="icon" />
        </a>
        <a
          className={styles.link}
          rel="noreferrer"
          href={NOTA_LINKS.issues}
          target="_blank"
        >
          {t['com.affine.aboutAFFiNE.contact.community']()}
          <OpenInNewIcon className="icon" />
        </a>
      </SettingWrapper>
      <SettingWrapper title={t['com.affine.aboutAFFiNE.legal.title']()}>
        <a
          className={styles.link}
          rel="noreferrer"
          href={NOTA_LINKS.privacy}
          target="_blank"
        >
          {t['com.affine.aboutAFFiNE.legal.privacy']()}
          <OpenInNewIcon className="icon" />
        </a>
        <a
          className={styles.link}
          rel="noreferrer"
          href={NOTA_LINKS.terms}
          target="_blank"
        >
          {t['com.affine.aboutAFFiNE.legal.tos']()}
          <OpenInNewIcon className="icon" />
        </a>
      </SettingWrapper>
    </>
  );
};
