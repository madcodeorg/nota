import { LiveData } from '@nota/infra';

// DOM node inside the left sidebar's AI panel. The active doc view portals
// its chat panel here so the chat lives in the left sidebar.
export const aiPanelSlot$ = new LiveData<HTMLElement | null>(null);

// DOM node inside the left sidebar's Page section. The workbench portals the
// active view's page panels (properties, outline, frames...) here.
export const pagePanelSlot$ = new LiveData<HTMLElement | null>(null);

export type SidebarSection =
  | 'notes'
  | 'ai'
  | 'meetings'
  | 'favorites'
  | 'organize'
  | 'collections'
  | 'tags'
  | 'page';

const SECTION_KEY = 'nota:sidebar-section';
const SECTIONS = new Set<SidebarSection>([
  'notes',
  'ai',
  'meetings',
  'favorites',
  'organize',
  'collections',
  'tags',
  'page',
]);

const readSection = (): SidebarSection => {
  try {
    const value = localStorage.getItem(SECTION_KEY) as SidebarSection | null;
    return value && SECTIONS.has(value) ? value : 'notes';
  } catch {
    return 'notes';
  }
};

export const sidebarSection$ = new LiveData<SidebarSection>(readSection());

export const setSidebarSection = (section: SidebarSection) => {
  sidebarSection$.next(section);
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // ignore storage failures
  }
};
