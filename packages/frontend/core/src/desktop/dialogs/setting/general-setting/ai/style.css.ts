import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const panel = style({
  minWidth: 0,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  containerType: 'inline-size',
  letterSpacing: 0,
});

globalStyle(`${panel} .title`, { letterSpacing: 0 });
globalStyle(`${panel} > div:first-child`, {
  paddingBottom: 12,
  marginBottom: 2,
});
export const section = style({
  padding: '14px 18px',
  marginBottom: 0,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  boxShadow: 'none',
  background: cssVarV2('layer/background/primary'),
});
globalStyle(`${section} > h2`, {
  margin: '0 0 12px',
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: cssVarV2('text/secondary'),
});
globalStyle(`${section} .two-col`, {
  marginBottom: 12,
});
globalStyle(`${section} .two-col:last-of-type`, {
  marginBottom: 0,
});
globalStyle(`${panel} .two-col`, {
  flexWrap: 'wrap',
  gap: 12,
});
globalStyle(`${panel} .two-col .left-col`, {
  minWidth: 180,
  maxWidth: '100%',
  flex: '1 1 180px',
  overflowWrap: 'anywhere',
});
globalStyle(`${panel} .two-col .right-col`, {
  paddingLeft: 0,
  minWidth: 0,
  maxWidth: '100%',
  '@container': {
    '(max-width: 480px)': { flexShrink: 1 },
  },
});
globalStyle(`${panel} [role="tab"]:focus-visible`, {
  outline: `2px solid ${cssVar('primaryColor')}`,
  outlineOffset: 2,
});

export const tabContent = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingTop: 2,
});
export const rowControl = style({
  width: 240,
  minWidth: 0,
  maxWidth: '100%',
});

export const menuTrigger = style({
  boxSizing: 'border-box',
  width: 240,
  maxWidth: '100%',
  minHeight: 36,
  padding: '7px 10px',
  borderRadius: 6,
  border: `1px solid ${cssVar('borderColor')}`,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  textAlign: 'left',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  cursor: 'pointer',
  ':disabled': { cursor: 'default', opacity: 0.6 },
});

export const menuContent = style({
  maxHeight: 'min(360px, var(--radix-popper-available-height, 360px))',
  maxWidth: 'min(480px, calc(100vw - 32px))',
  overflowY: 'auto',
});
globalStyle(`${menuContent} [role="menuitem"]`, {
  height: 'auto',
  minHeight: 36,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
});
globalStyle(`${menuContent} [aria-disabled="true"]`, {
  opacity: 0.5,
  cursor: 'not-allowed',
});

export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '2px 8px',
  borderRadius: 4,
  background: cssVarV2('chip/label/blue'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  overflowWrap: 'anywhere',
});
export const mutedStatus = style({
  background: cssVar('hoverColor'),
  color: cssVar('textSecondaryColor'),
});
export const saveBar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 0 0',
  marginTop: 2,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
});
export const notice = style({
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVar('textSecondaryColor'),
  overflowWrap: 'anywhere',
});
export const statusNotice = style([
  notice,
  {
    marginTop: 4,
    padding: '8px 12px',
    borderRadius: 6,
    background: cssVar('hoverColor'),
  },
]);
export const error = style([
  notice,
  {
    marginTop: 8,
    padding: '8px 12px',
    borderRadius: 6,
    borderLeft: `3px solid ${cssVarV2('status/error')}`,
    background: cssVar('hoverColor'),
    color: cssVarV2('status/error'),
  },
]);
export const device = style([notice, { marginBottom: 0 }]);
export const disclosureHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 8,
});
export const chatgptCompactRow = style({
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  marginBottom: 8,
  selectors: {
    '&:last-of-type': {
      marginBottom: 0,
    },
  },
});

export const chatgptCompactActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
  minWidth: 0,
  maxWidth: '100%',
});
globalStyle(`${chatgptCompactRow} ${chatgptCompactActions}`, {
  justifyContent: 'flex-start',
});

export const providerConnectionGroup = style({
  marginTop: 12,
  paddingTop: 12,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&[hidden]': {
      display: 'none',
    },
  },
});

export const disclosure = style({
  minWidth: 0,
  padding: '12px 18px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  background: cssVarV2('layer/background/primary'),
});
globalStyle(`${section} ${disclosure}`, {
  padding: '8px 12px',
  margin: '8px 0 12px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVar('hoverColor'),
});
export const disclosureSummary = style({
  listStyle: 'none',
  position: 'relative',
  paddingRight: 24,
  cursor: 'pointer',
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  lineHeight: '20px',
  overflowWrap: 'anywhere',
  userSelect: 'none',
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: 2,
  },
  selectors: {
    '&::-webkit-details-marker': {
      display: 'none',
    },
    '&::after': {
      content: '"\u25B8"',
      position: 'absolute',
      right: 2,
      top: '50%',
      transform: 'translateY(-50%)',
      color: cssVar('textSecondaryColor'),
      fontSize: cssVar('fontSm'),
      transition: 'transform 150ms ease',
    },
  },
});
globalStyle(`${disclosure}[open] > ${disclosureSummary}::after`, {
  transform: 'translateY(-50%) rotate(90deg)',
});
globalStyle(`${disclosureSummary} > span + span`, {
  display: 'block',
  marginTop: 4,
  fontWeight: 400,
});
export const disclosureContent = style({
  minWidth: 0,
  marginTop: 12,
  paddingTop: 12,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
