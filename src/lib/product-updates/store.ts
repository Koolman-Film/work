'use client';

/**
 * Client state for product-updates. Sibling client components (sidebar
 * button, topbar menu, orchestrator) share this one hook.
 *
 * `seen` is the per-user set, hydrated once from a server-provided array via
 * hydrate(initialSeen) (called by the orchestrator on mount with the value
 * the admin layout loaded from User.productUpdatesSeen). Writes update local
 * state optimistically and persist through the markProductUpdatesSeen server
 * action; the server column is the source of truth across devices.
 */

import { create } from 'zustand';
import { markProductUpdatesSeen } from './actions';

type ProductUpdatesState = {
  panelOpen: boolean;
  activeTourId: string | null;
  seen: Set<string>;
  hydrated: boolean;
  hydrate: (initialSeen: string[]) => void;
  openPanel: () => void;
  closePanel: () => void;
  startTour: (id: string) => void;
  endTour: () => void;
  markSeen: (id: string) => void;
  markManySeen: (ids: string[]) => void;
};

/** Fire-and-forget persist; degrade silently on failure (at worst a re-show
 *  on a later login), matching the old localStorage silent-degrade posture. */
function persist(ids: string[]): void {
  void markProductUpdatesSeen(ids).catch((err) => {
    console.warn('[product-updates] failed to persist seen ids', err);
  });
}

export const useProductUpdates = create<ProductUpdatesState>((set, get) => ({
  panelOpen: false,
  activeTourId: null,
  seen: new Set(),
  hydrated: false,
  hydrate: (initialSeen) => {
    if (get().hydrated) return;
    set({ seen: new Set(initialSeen), hydrated: true });
  },
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  startTour: (id) => set({ activeTourId: id }),
  endTour: () => set({ activeTourId: null }),
  markSeen: (id) => {
    const seen = new Set(get().seen);
    seen.add(id);
    set({ seen });
    persist([id]);
  },
  markManySeen: (ids) => {
    const seen = new Set(get().seen);
    for (const id of ids) seen.add(id);
    set({ seen });
    persist(ids);
  },
}));
