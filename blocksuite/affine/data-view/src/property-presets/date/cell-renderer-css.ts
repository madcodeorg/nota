import { css } from '@emotion/css';
import { baseTheme } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';

export const dateCellStyle = css({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '0',
  border: 'none',
  fontFamily: baseTheme.fontSansFamily,
  color: 'var(--affine-text-primary-color)',
  fontWeight: '400',
  backgroundColor: 'transparent',
  fontSize: 'var(--data-view-cell-text-size)',
  lineHeight: 'var(--data-view-cell-text-line-height)',
  height: 'var(--data-view-cell-text-line-height)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const dateValueContainerStyle = css({
  padding: '12px',
  backgroundColor: 'var(--layer-background-primary)',
  borderRadius: '12px',
  color: 'var(--text-secondary)',
  fontSize: '15px',
  lineHeight: '22px',
  minHeight: '30px',
});

export const datePickerContainerStyle = css({
  padding: '8px',
  backgroundColor: 'var(--layer-background-primary)',
  borderRadius: '12px',
});

export const datePopoverStyle = css({
  position: 'absolute',
  zIndex: 1002,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  width: '300px',
  padding: '12px',
  borderRadius: '10px',
  border: `0.5px solid ${cssVarV2('layer/insideBorder/blackBorder')}`,
  backgroundColor: cssVarV2.layer.background.overlayPanel,
  boxShadow: 'var(--affine-shadow-1)',
  color: cssVarV2('text/primary'),
  fontFamily: baseTheme.fontSansFamily,
  '@media print': {
    display: 'none',
  },
});

export const datePopoverInlineStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  width: '100%',
  color: cssVarV2('text/primary'),
  fontFamily: baseTheme.fontSansFamily,
});

export const dateInputsSectionStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
});

export const dateInputRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 6px',
  borderRadius: '6px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  backgroundColor: 'transparent',
  cursor: 'pointer',
});

export const dateInputRowActiveStyle = css({
  borderColor: cssVarV2('layer/insideBorder/primaryBorder'),
});

export const dateInputLabelStyle = css({
  fontSize: '11px',
  fontWeight: 500,
  color: cssVarV2('text/secondary'),
  minWidth: '34px',
  userSelect: 'none',
});

export const dateNativeInputStyle = css({
  flex: 1,
  minWidth: 0,
  border: 'none',
  backgroundColor: 'transparent',
  color: cssVarV2('text/primary'),
  fontFamily: baseTheme.fontSansFamily,
  fontSize: '13px',
  lineHeight: '20px',
  outline: 'none',
});

export const dateTimeInputStyle = css({
  width: '78px',
  flexShrink: 0,
  border: 'none',
  borderLeft: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  paddingLeft: '6px',
  backgroundColor: 'transparent',
  color: cssVarV2('text/primary'),
  fontFamily: baseTheme.fontSansFamily,
  fontSize: '13px',
  lineHeight: '20px',
  outline: 'none',
});

export const dateCalendarWrapStyle = css({
  display: 'flex',
  justifyContent: 'center',
});

export const dateTogglesSectionStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  paddingTop: '8px',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const dateToggleRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '13px',
  lineHeight: '20px',
  color: cssVarV2('text/primary'),
  cursor: 'pointer',
  userSelect: 'none',
  padding: '2px 4px',
  borderRadius: '4px',
  ':hover': {
    backgroundColor: cssVarV2('layer/background/hoverOverlay'),
  },
});

export const dateToggleSwitchStyle = css({
  appearance: 'none',
  WebkitAppearance: 'none',
  position: 'relative',
  width: '30px',
  height: '18px',
  margin: 0,
  flexShrink: 0,
  borderRadius: '999px',
  backgroundColor: 'rgba(128, 128, 128, 0.38)',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  cursor: 'pointer',
  transition: 'background-color 0.15s ease, border-color 0.15s ease',
  '::before': {
    content: '""',
    position: 'absolute',
    top: '1px',
    left: '1px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
    transition: 'transform 0.15s ease',
  },
  ':checked': {
    backgroundColor: cssVarV2('button/primary'),
    borderColor: cssVarV2('button/primary'),
  },
  ':checked::before': {
    transform: 'translateX(12px)',
  },
  ':focus-visible': {
    outline: `2px solid ${cssVarV2('button/primary')}`,
    outlineOffset: '1px',
  },
});

export const dateFooterRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  paddingTop: '6px',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const dateClearButtonStyle = css({
  border: 'none',
  backgroundColor: 'transparent',
  color: cssVarV2('text/secondary'),
  fontSize: '12px',
  lineHeight: '18px',
  padding: '4px 8px',
  borderRadius: '4px',
  cursor: 'pointer',
  ':hover': {
    backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    color: cssVarV2('text/primary'),
  },
});
