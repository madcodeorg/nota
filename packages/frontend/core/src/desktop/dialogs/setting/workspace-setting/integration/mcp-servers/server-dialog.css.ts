import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxHeight: 'calc(100dvh - 220px)',
  overflowY: 'auto',
  padding: '4px 2px',
  marginTop: 12,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const label = style({
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
  color: cssVarV2('text/primary'),
});

export const hint = style({
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
});

export const error = style({
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2('status/error'),
});

export const iconRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const iconButton = style({
  width: 48,
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('icon/primary'),
  fontSize: 20,
  cursor: 'pointer',
  overflow: 'hidden',
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: 2,
  },
});

// The global input reset overrides the `hidden` attribute.
export const fileInput = style({
  display: 'none',
});

export const iconPreview = style({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

export const menuTrigger = style({
  width: '100%',
});

export const rowGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const rowInput = style({
  flex: 1,
  minWidth: 0,
});

export const textarea = style({
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 72,
  resize: 'vertical',
  padding: '6px 10px',
  borderRadius: 8,
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

export const disclosure = style({
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  padding: '8px 12px',
});

export const disclosureSummary = style({
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  color: cssVarV2('text/primary'),
});

export const disclosureContent = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 12,
});

export const warning = style({
  display: 'flex',
  gap: 10,
  padding: 12,
  borderRadius: 8,
  background: cssVarV2('layer/background/warning'),
});

export const warningIcon = style({
  flexShrink: 0,
  fontSize: 20,
  color: cssVarV2('icon/primary'),
});

export const warningTitle = style({
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const warningText = style({
  marginTop: 4,
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
});

export const understand = style({
  marginTop: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: cssVarV2('text/primary'),
});

export const footer = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 16,
});
