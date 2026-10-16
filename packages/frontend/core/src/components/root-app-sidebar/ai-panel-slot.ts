import type { AffineEditorContainer } from '@nota/core/blocksuite/block-suite-editor';
import { LiveData } from '@nota/infra';

// The left sidebar's AI panel container; set while the sidebar chat exists.
export const aiPanelSlot$ = new LiveData<HTMLElement | null>(null);

export type SidebarChatTarget = { docId: string; sessionId?: string };

// The note the sidebar chat is linked to. It changes only when chat is opened
// from a note, so the conversation survives navigating to other pages.
export const sidebarChat$ = new LiveData<SidebarChatTarget | null>(null);

export const linkSidebarChat = (target: SidebarChatTarget) => {
  const current = sidebarChat$.value;
  if (current?.docId === target.docId && !target.sessionId) return;
  sidebarChat$.next(target);
};

// Editor of the active doc view, so the sidebar chat can act on the live
// editor when it shows the linked note.
export const activeDocEditor$ = new LiveData<AffineEditorContainer | null>(
  null
);

// Session handed to the full-page chat without exposing its id in the URL.
export const pendingFullChatSessionId$ = new LiveData<string | null>(null);

// Asks the full-page chat to start an empty conversation.
export const pendingNewFullChat$ = new LiveData(false);

// Session shown by the full-page chat, so the sidebar can highlight it.
export const fullChatSessionId$ = new LiveData<string | null>(null);

// Bumped when chats are created, answered or deleted, so the sidebar history
// reloads (titles are set after the first answer).
export const chatHistoryVersion$ = new LiveData(0);
export const notifyChatHistoryChanged = () =>
  chatHistoryVersion$.next(chatHistoryVersion$.value + 1);

// DOM node inside the left sidebar's Page section. The workbench portals the
// active view's page panels (properties, outline, frames...) here.
export const pagePanelSlot$ = new LiveData<HTMLElement | null>(null);

export type SidebarSection =
  | 'notes'
  | 'chats'
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
  'chats',
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
