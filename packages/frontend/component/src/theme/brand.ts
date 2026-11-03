// Brand colors live here only. theme.css.ts turns them into CSS variables
// (--nota-accent, --nota-frame-background) that the rest of the app reads.

export const ACCENT_PRESETS = {
  coral: { label: 'Coral', light: '#e5432f', dark: '#f2604f' },
  indigo: { label: 'Indigo', light: '#4f5bd5', dark: '#7d87f2' },
  green: { label: 'Green', light: '#13845e', dark: '#34b886' },
} as const;

export type AccentColor = keyof typeof ACCENT_PRESETS;

export const DEFAULT_ACCENT_COLOR: AccentColor = 'coral';

// The window frame (tab bar and sidebar) stays charcoal in both themes.
export const FRAME_BACKGROUND = { light: '#1d1d20', dark: '#0b0b0c' } as const;
