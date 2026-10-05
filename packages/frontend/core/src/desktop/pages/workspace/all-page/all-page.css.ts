import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const scrollContainer = style({
  flex: 1,
  width: '100%',
  paddingBottom: '32px',
});
export const headerCreateNewButton = style({
  transition: 'opacity 0.1s ease-in-out',
});

export const headerCreateNewCollectionIconButton = style({
  padding: '4px 10px',
  fontSize: '16px',
  width: '36px',
  height: '32px',
  borderRadius: '14px',
  border: '1px solid rgba(111, 127, 84, 0.18)',
  background: 'rgba(111, 127, 84, 0.08)',
});
export const headerCreateNewButtonHidden = style({
  opacity: 0,
  pointerEvents: 'none',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  width: '100%',
  containerName: 'docs-body',
  containerType: 'size',
});

export const scrollArea = style({
  height: 0,
  flex: 1,
  paddingTop: '14px',
});

// group

export const pinnedCollection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '0 40px',
  paddingTop: '22px',
  '@container': {
    'docs-body (width <= 500px)': {
      padding: '0 20px',
    },
    'docs-body (width <= 393px)': {
      padding: '0 16px',
    },
  },
});

export const filterArea = style({
  padding: '0 40px',
  paddingTop: '12px',
  '@container': {
    'docs-body (width <= 500px)': {
      padding: '0 20px',
    },
    'docs-body (width <= 393px)': {
      padding: '0 16px',
    },
  },
});

export const filterInnerArea = style({
  display: 'flex',
  flexDirection: 'row',
  gap: 10,
  padding: '10px',
  background:
    'linear-gradient(180deg, rgba(111, 127, 84, 0.12), rgba(111, 127, 84, 0.06)), ' +
    cssVarV2('layer/background/secondary'),
  borderRadius: '22px',
  border: '1px solid rgba(111, 127, 84, 0.16)',
  boxShadow: '0 10px 24px rgba(16, 24, 12, 0.1)',
});

export const filters = style({
  flex: 1,
});
