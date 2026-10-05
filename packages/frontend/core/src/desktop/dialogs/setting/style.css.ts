import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const wrapper = style({
  height: '100%',
  padding: '44px 32px 28px',
  display: 'flex',
  background: cssVarV2('layer/background/secondary'),
});
export const centerContainer = style({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: 'fit-content',
});
export const content = style({
  position: 'relative',
  width: '100%',
  marginBottom: '24px',
  minHeight: 'calc(var(--setting-modal-height) - 124px)',
  maxWidth: '640px',
});
export const suggestionLink = style({
  fontSize: cssVar('fontSm'),
  color: cssVar('textPrimaryColor'),
  display: 'flex',
  alignItems: 'start',
  lineHeight: '22px',
  gap: '12px',
});
export const suggestionLinkIcon = style({
  color: cssVar('iconColor'),
  marginRight: '12px',
  display: 'flex',
  margin: '3px 0',
});
export const footer = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: '100%',
  paddingTop: '18px',
  paddingBottom: '20px',
  gap: '6px',
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  flexWrap: 'wrap',
  maxWidth: '640px',
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const link = style({
  color: cssVar('linkColor'),
  fontWeight: 500,
  cursor: 'pointer',
});

export const centeredLoading = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
  width: '100%',
});
