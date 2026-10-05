import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const panel = style({
  minWidth: 0,
  width: '100%',
  containerType: 'inline-size',
  letterSpacing: 0,
});

globalStyle(`${panel} .title`, { letterSpacing: 0 });
globalStyle(`${panel} > div:first-child`, {
  paddingBottom: 16,
  marginBottom: 20,
});
export const section = style({
  padding: '16px 0',
  marginBottom: 0,
  border: 0,
  borderRadius: 0,
  boxShadow: 'none',
  background: 'transparent',
});
globalStyle(`${section} > h2`, {
  margin: '0 0 16px',
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  lineHeight: '20px',
  color: cssVar('textPrimaryColor'),
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

export const tabContent = style({ minWidth: 0, gap: 8 });
export const rowControl = style({
  width: 280,
  minWidth: 0,
  maxWidth: '100%',
});

export const textarea = style({
  boxSizing: 'border-box',
  width: 360,
  maxWidth: '100%',
  minHeight: 112,
  resize: 'vertical',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${cssVar('borderColor')}`,
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: 2,
  },
});

export const menuTrigger = style({
  boxSizing: 'border-box',
  width: 280,
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
  gap: 12,
  padding: '16px 0',
  marginTop: 16,
  borderTop: `1px solid ${cssVar('borderColor')}`,
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
export const error = style([notice, { color: cssVarV2('status/error') }]);
export const device = style([notice, { marginBottom: 12 }]);
export const capability = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
});
export const dot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: cssVarV2('status/success'),
  flexShrink: 0,
});
export const pendingDot = style({
  background: cssVar('textSecondaryColor'),
});
