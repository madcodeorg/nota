import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
});

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 20px',
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const title = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 600,
  color: cssVarV2.text.primary,
});

export const meta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2.text.secondary,
});

export const spacer = style({
  flex: 1,
});

export const canvas = style({
  flex: 1,
  minHeight: 0,
  width: '100%',
  cursor: 'grab',
  touchAction: 'none',
});

export const empty = style({
  padding: 40,
  textAlign: 'center',
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
});
