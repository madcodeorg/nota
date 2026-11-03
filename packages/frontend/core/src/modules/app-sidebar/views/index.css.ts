import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const navWrapperStyle = style({
  '@media': {
    print: {
      display: 'none',
      zIndex: -1,
    },
  },
  paddingBottom: 8,
  position: 'relative',
  overflow: 'hidden',
  // Re-resolve text color under this element's own data-theme instead of
  // inheriting the color body computed for the page theme.
  color: cssVarV2('text/primary'),
  selectors: {
    // The open desktop sidebar sits directly on the window frame color.
    '&[data-open="true"][data-is-electron="true"]': {
      background: 'transparent',
    },
    // the resize handle straddles the edge; the content clips itself
    '&[data-open="true"]:not([data-is-floating="true"])': {
      overflow: 'visible',
    },
    '&[data-has-border=true]': {
      borderRight: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
    '&[data-is-floating="true"], &[data-is-electron="false"]': {
      background: 'var(--nota-frame-background)',
    },
  },
});
export const hoverNavWrapperStyle = style({
  selectors: {
    '&[data-is-floating="true"]': {
      background: cssVarV2('layer/background/overlayPanel'),
      height: 'calc(100% - 60px)',
      marginTop: '52px',
      marginLeft: '6px',
      boxShadow: `${cssVar('shadow3')}, var(--nota-panel-shadow)`,
      borderRadius: 'var(--nota-panel-radius, 16px)',
      overflow: 'hidden',
    },
    '&[data-is-floating="true"][data-is-electron="true"]': {
      height: '100%',
      marginTop: '-4px',
    },
    '&[data-is-floating="true"][data-client-border="true"]': {
      background: cssVarV2('layer/background/overlayPanel'),
    },
    '&[data-is-floating="true"][data-client-border="true"]::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      opacity: `var(--affine-noise-opacity, 0)`,
      backgroundRepeat: 'repeat',
      backgroundSize: '50px',
      // TODO(@Peng): figure out how to use vanilla-extract webpack plugin to inject img url
      backgroundImage: `var(--noise-background)`,
    },
  },
});
export const navHeaderButton = style({
  width: '34px',
  height: '34px',
  flexShrink: 0,
});
export const navHeaderNavigationButtons = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: '32px',
});
export const navStyle = style({
  position: 'relative',
  zIndex: 1,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
});
// Always-visible icon rail to the left of the collapsible panel.
export const railColumnStyle = style({
  position: 'relative',
  zIndex: 4,
  flex: '0 0 52px',
  width: 52,
  height: '100%',
  display: 'flex',
  color: cssVarV2('text/primary'),
  '@media': { print: { display: 'none' } },
});

export const navHeaderStyle = style({
  flex: '0 0 auto',
  // Sits over the icon rail column so the panel can use the full height.
  position: 'absolute',
  top: 0,
  left: 0,
  zIndex: 1,
  width: 52,
  height: '56px',
  padding: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
});

export const navBodyStyle = style({
  flex: '1 1 auto',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  rowGap: '6px',
  padding: '0 8px 8px',
});
export const sidebarFloatMaskStyle = style({
  transition: 'opacity .15s',
  opacity: 0,
  pointerEvents: 'none',
  position: 'fixed',
  top: 0,
  left: 0,
  right: '100%',
  bottom: 0,
  background: cssVarV2('layer/background/modal'),
  selectors: {
    '&[data-open="true"][data-is-floating="true"]': {
      opacity: 1,
      pointerEvents: 'auto',
      right: '0',
      zIndex: 3,
    },
  },
  '@media': {
    print: {
      display: 'none',
    },
  },
});

export const resizeHandleShortcutStyle = style({
  alignItems: 'flex-end',
  marginBottom: '2px',
});
