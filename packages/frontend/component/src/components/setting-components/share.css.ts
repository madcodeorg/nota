import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

/**
 * Setting page header — the title + subtitle block at the top of each panel.
 * Distinct from AFFiNE's plain full-width divider: larger title, soft subtitle
 * and a short sage accent underline.
 */
export const settingHeader = style({
  position: 'relative',
  paddingBottom: '20px',
  marginBottom: '28px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  whiteSpace: 'pre-wrap',
});
globalStyle(`${settingHeader}::after`, {
  content: '""',
  position: 'absolute',
  left: 0,
  bottom: '-1px',
  height: '2px',
  width: '56px',
  borderRadius: '2px',
  background: cssVar('primaryColor'),
});
globalStyle(`${settingHeader} .title`, {
  fontSize: cssVar('fontH4'),
  fontWeight: 600,
  lineHeight: '30px',
  letterSpacing: '-0.01em',
  color: cssVarV2('text/primary'),
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  position: 'relative',
});
globalStyle(`${settingHeader} .subtitle`, {
  paddingTop: '6px',
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
});

/**
 * Section card — replaces AFFiNE's border-bottom sections with grouped,
 * rounded surfaces that sit on the settings canvas.
 */
export const wrapper = style({
  position: 'relative',
  padding: '18px 20px',
  marginBottom: '16px',
  borderRadius: '12px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  boxShadow: '0 1px 2px rgba(16, 18, 14, 0.04)',
  selectors: {
    '&:last-of-type': {
      marginBottom: '0',
    },
    '[data-theme="dark"] &': {
      boxShadow: 'none',
    },
  },
});
export const wrapperDisabled = style({
  opacity: 0.5,
  pointerEvents: 'none',
});
globalStyle(`${wrapper} .title`, {
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: cssVarV2('text/secondary'),
  marginBottom: '16px',
});

/**
 * A single setting row inside a card.
 */
export const settingRow = style({
  marginBottom: '18px',
  color: cssVarV2('text/primary'),
  borderRadius: '8px',
  selectors: {
    '&.two-col': {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
    },
    '&:last-of-type': {
      marginBottom: '0',
    },
    '&.disabled': {
      opacity: 0.4,
      pointerEvents: 'none',
    },
  },
});
globalStyle(`${settingRow} .left-col`, {
  flex: 1,
  maxWidth: '100%',
});
globalStyle(`${settingRow}.two-col .left-col`, {
  flexShrink: 0,
  maxWidth: '80%',
});
globalStyle(`${settingRow} .name`, {
  marginBottom: '2px',
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});
globalStyle(`${settingRow} .desc`, {
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
});
globalStyle(`${settingRow} .right-col`, {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingLeft: '16px',
  flexShrink: 0,
});

export const settingHeaderBeta = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVar('primaryColor'),
  background: cssVar('hoverColorFilled'),
  padding: '0 8px',
  borderRadius: '6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 20,
});
