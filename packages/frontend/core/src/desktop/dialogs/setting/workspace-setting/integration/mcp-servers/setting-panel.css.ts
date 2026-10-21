import { cssVarV2 } from '@toeverything/theme/v2';
import { style, styleVariants } from '@vanilla-extract/css';

export const panel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

export const notice = style({
  fontSize: 13,
  lineHeight: '22px',
  color: cssVarV2('text/secondary'),
});

export const errorText = style({
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2('status/error'),
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 8,
});

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

export const sectionTitle = style({
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const empty = style({
  padding: '16px 12px',
  borderRadius: 8,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'center',
  color: cssVarV2('text/secondary'),
});

export const serverList = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const serverRow = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '10px 12px',
  selectors: {
    '&:not(:last-child)': {
      borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const serverIcon = style({
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 6,
  objectFit: 'cover',
});

export const serverInfo = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
});

export const serverTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});

export const serverName = style({
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const serverDesc = style({
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const serverActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 4,
  marginLeft: -8,
});

export const pill = style({
  flexShrink: 0,
  padding: '0 8px',
  borderRadius: 10,
  fontSize: 11,
  lineHeight: '18px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

export const pillState = styleVariants({
  ready: {
    background: cssVarV2('layer/background/success'),
    color: cssVarV2('status/success'),
  },
  gated: {
    background: cssVarV2('layer/background/warning'),
    color: cssVarV2('text/primary'),
  },
  error: {
    background: cssVarV2('layer/background/error'),
    color: cssVarV2('status/error'),
  },
  'auth-required': {
    background: cssVarV2('layer/background/warning'),
    color: cssVarV2('text/primary'),
  },
  disabled: {
    background: cssVarV2('layer/background/secondary'),
    color: cssVarV2('text/secondary'),
  },
});

export const tag = style({
  flexShrink: 0,
  padding: '0 6px',
  borderRadius: 4,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  fontSize: 11,
  lineHeight: '16px',
  color: cssVarV2('text/secondary'),
});

export const featuredCard = style({
  height: 'auto',
  minHeight: 150,
});
