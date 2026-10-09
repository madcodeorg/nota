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
  selectors: {
    '&[data-open="true"][data-is-electron="true"]': {
      background:
        'linear-gradient(180deg, rgba(252, 253, 249, 0.98) 0%, rgba(246, 249, 241, 0.96) 46%, rgba(250, 250, 249, 0.98) 100%)',
      borderRight: '1px solid rgba(111, 127, 84, 0.14)',
      boxShadow:
        'inset -1px 0 0 rgba(111, 127, 84, 0.06), 10px 0 26px rgba(79, 94, 62, 0.055)',
      backdropFilter: 'blur(18px) saturate(1.04)',
    },
    '[data-theme="dark"] &[data-open="true"][data-is-electron="true"]': {
      background:
        'linear-gradient(180deg, rgba(20, 28, 25, 0.98) 0%, rgba(14, 18, 17, 0.96) 42%, rgba(10, 12, 12, 0.96) 100%)',
      borderRight: '1px solid rgba(204, 223, 149, 0.12)',
      boxShadow:
        'inset -1px 0 0 rgba(0, 0, 0, 0.22), 14px 0 34px rgba(0, 0, 0, 0.16)',
      backdropFilter: 'blur(18px) saturate(1.05)',
    },
    '&[data-open="true"][data-is-electron="true"]::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      background:
        'radial-gradient(circle at 36px 28px, rgba(111, 127, 84, 0.075), transparent 170px), linear-gradient(180deg, rgba(255, 255, 255, 0.58), transparent 220px)',
    },
    '[data-theme="dark"] &[data-open="true"][data-is-electron="true"]::before':
      {
        content: '""',
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          'radial-gradient(circle at 36px 28px, rgba(204, 223, 149, 0.08), transparent 170px), linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent 220px)',
      },
    '&[data-has-border=true]': {
      borderRight: '1px solid rgba(111, 127, 84, 0.12)',
    },
    '&[data-is-floating="true"], &[data-is-electron="false"]': {
      background:
        'linear-gradient(180deg, rgba(111, 127, 84, 0.045), transparent 150px), ' +
        cssVarV2('layer/background/primary'),
    },
  },
});
export const hoverNavWrapperStyle = style({
  selectors: {
    '&[data-is-floating="true"]': {
      background:
        'linear-gradient(180deg, rgba(111, 127, 84, 0.06), transparent 180px), ' +
        cssVarV2('layer/background/primary'),
      height: 'calc(100% - 60px)',
      marginTop: '52px',
      marginLeft: '6px',
      boxShadow:
        '0 18px 42px rgba(79, 94, 62, 0.12), 0 0 0 1px rgba(111, 127, 84, 0.13)',
      borderRadius: '14px',
      overflow: 'hidden',
    },
    '&[data-is-floating="true"][data-is-electron="true"]': {
      height: '100%',
      marginTop: '-4px',
    },
    '&[data-is-floating="true"][data-client-border="true"]': {
      background:
        'linear-gradient(180deg, rgba(111, 127, 84, 0.055), transparent 180px), ' +
        cssVarV2('layer/background/overlayPanel'),
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
