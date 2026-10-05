import { cssVar, lightCssVariables } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

export const appStyle = style({
  width: '100%',
  position: 'relative',
  height: '100dvh',
  flexGrow: '1',
  display: 'flex',
  backgroundColor: cssVar('backgroundPrimaryColor'),
  selectors: {
    '&.blur-background': {
      backgroundColor: 'transparent',
    },
    '&.noisy-background::before': {
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
globalStyle(`html[data-theme="light"] ${appStyle}`, {
  vars: {
    '--affine-noise-opacity': '0.2',
  },
});
globalStyle(`html[data-theme="dark"] ${appStyle}`, {
  vars: {
    '--affine-noise-opacity': '1',
  },
  '@media': {
    print: {
      vars: lightCssVariables,
    },
  },
});

export const browserAppViewContainer = style({
  display: 'flex',
  flexFlow: 'row',
  height: '100%',
  width: '100%',
  position: 'relative',
});

export const desktopAppViewContainer = style({
  display: 'flex',
  flexFlow: 'column',
  height: '100%',
  width: '100%',
});

export const desktopAppViewMain = style({
  display: 'flex',
  flexFlow: 'row',
  width: '100%',
  height: 'calc(100% - 40px)',
  position: 'relative',
});

export const desktopTabsHeader = style({
  display: 'flex',
  flexFlow: 'row',
  height: '40px',
  zIndex: 1,
  width: '100%',
  overflow: 'hidden',
});

export const headerLeftCluster = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flexShrink: 1,
});

export const headerSearchPill = style({
  ['WebkitAppRegion' as string]: 'no-drag',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 30,
  minWidth: 78,
  maxWidth: 86,
  padding: '0 11px 0 10px',
  border: '1px solid rgba(111, 127, 84, 0.22)',
  borderRadius: 999,
  background: 'rgba(111, 127, 84, 0.12)',
  color: cssVar('textSecondaryColor'),
  cursor: 'pointer',
  flexShrink: 1,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  transition:
    'background-color .16s ease, border-color .16s ease, color .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.18)',
      borderColor: 'rgba(111, 127, 84, 0.34)',
      color: cssVar('textPrimaryColor'),
    },
    '&:active': {
      transform: 'scale(0.98)',
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVar('primaryColor')}`,
      outlineOffset: 2,
    },
  },
});

export const headerSearchPillIcon = style({
  flexShrink: 0,
  width: 15,
  height: 15,
});

export const headerSearchPillLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const mainContainerStyle = style({
  position: 'relative',
  zIndex: 0,
  width: '100%',
  display: 'flex',
  flex: 1,
  maxWidth: '100%',

  selectors: {
    '&[data-client-border="true"]': {
      borderRadius: 6,
      padding: '8px',
      '@media': {
        print: {
          overflow: 'visible',
          padding: '0px',
          borderRadius: '0px',
        },
      },
    },
    '&[data-client-border="true"][data-side-bar-open="true"]': {
      paddingLeft: 0,
    },
    '&[data-client-border="true"][data-is-desktop="true"]': {
      paddingTop: 0,
    },
    '&[data-client-border="false"][data-is-desktop="true"][data-side-bar-open="true"]':
      {
        borderTopLeftRadius: 6,
      },
    '&[data-client-border="false"][data-is-desktop="true"]': {
      borderTop: `0.5px solid ${cssVar('borderColor')}`,
      borderLeft: `0.5px solid ${cssVar('borderColor')}`,
    },
    '&[data-transparent=true]': {
      backgroundColor: 'transparent',
    },
  },
});
