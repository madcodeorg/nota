import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const meetingWrapper = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
  containerType: 'inline-size',
});

globalStyle(`${meetingWrapper} > div:not(:first-child)`, {
  border: 0,
  borderTop: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 0,
  background: 'transparent',
  boxShadow: 'none',
  padding: '20px 0 0',
  marginBottom: 0,
});

globalStyle(`${meetingWrapper} > div .title`, {
  letterSpacing: 0,
});

globalStyle(`${meetingWrapper} .two-col`, {
  flexWrap: 'wrap',
});

globalStyle(`${meetingWrapper} .two-col .left-col`, {
  minWidth: 150,
  flexShrink: 1,
});

globalStyle(`${meetingWrapper} .right-col`, {
  maxWidth: '100%',
  paddingLeft: 0,
});

export const transcriptionSection = style({
  minWidth: 0,
});

export const modelSettingsCard = style({
  padding: '4px 16px 16px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 10,
  minWidth: 0,
});

export const transcriptionControls = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
  gap: 20,
  '@container': {
    '(max-width: 560px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 0,
    },
  },
});

export const transcriptionControl = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 0',
  marginBottom: 0,
  alignItems: 'stretch',
});

globalStyle(`${transcriptionControl} > .left-col`, {
  flexGrow: 1,
});

export const readonlyLanguage = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 36,
  padding: '7px 12px',
  marginTop: 8,
  borderRadius: 6,
  background: cssVar('hoverColor'),
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
});

export const selectedModel = style({
  marginTop: 4,
  borderTop: `1px solid ${cssVar('borderColor')}`,
});

export const languageCoverage = style({
  marginTop: 8,
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

globalStyle(`${languageCoverage} > summary`, {
  cursor: 'pointer',
});

globalStyle(`${languageCoverage} > summary:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: 2,
});

export const languageList = style({
  paddingLeft: 20,
  margin: '8px 0 0',
  maxHeight: 180,
  overflowY: 'auto',
  lineHeight: 1.6,
});

export const settingMenu = style({
  fontWeight: 600,
  width: 250,
  maxWidth: '100%',
});

export const providerMenu = style({
  marginTop: 8,
  width: '100%',
  minHeight: 36,
  height: 'auto',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  borderRadius: 6,
});

export const providerMenuContent = style({
  width: 'var(--radix-dropdown-menu-trigger-width)',
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'min(360px, var(--radix-dropdown-menu-content-available-height))',
  overflowY: 'auto',
});

export const menuOption = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
});

export const autoStatus = style({
  marginTop: 12,
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  overflowWrap: 'anywhere',
});

export const actionError = style({
  marginTop: 8,
  padding: '8px 10px',
  borderLeft: `2px solid ${cssVarV2('status/error')}`,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/primary'),
  overflowWrap: 'anywhere',
});

export const otherModels = style({
  marginTop: 8,
  padding: '0 16px',
});

globalStyle(`${otherModels} > summary`, {
  padding: '12px 0',
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
  cursor: 'pointer',
  color: cssVar('textPrimaryColor'),
});

globalStyle(`${otherModels} > summary:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: 2,
});

export const permissionActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 8,
});

export const permissionGranted = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
});

export const permissionGrantedIcon = style({
  width: 16,
  height: 16,
  color: cssVarV2('status/success'),
});

export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 24,
  padding: '0 8px',
  borderRadius: 4,
  background: cssVarV2('chip/label/blue'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
});

export const mutedStatus = style({
  background: cssVar('hoverColor'),
  color: cssVar('textSecondaryColor'),
});

export const modelBadge = style({
  padding: '2px 6px',
  borderRadius: 4,
  background: cssVarV2('chip/label/blue'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  textTransform: 'capitalize',
  flexShrink: 0,
  maxWidth: '100%',
});

export const modelBadgeMuted = style({
  background: cssVar('hoverColor'),
  color: cssVar('textSecondaryColor'),
});

export const providerRow = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8,
  padding: '14px 0',
  selectors: {
    '&:not(:last-child)': {
      borderBottom: `1px solid ${cssVar('borderColor')}`,
    },
  },
  color: cssVar('textPrimaryColor'),
});

export const providerCardHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
});

export const providerName = style({
  minWidth: 0,
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
  flex: '1 1 180px',
});

export const providerMeta = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
});

export const providerDescription = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
});

export const providerFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 'auto',
  flexWrap: 'wrap',
});

export const connectedActions = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});

export const savingHint = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  display: 'block',
  selectors: {
    '&:empty': { display: 'none' },
  },
});
