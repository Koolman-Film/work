'use client';

/**
 * Client state for product-updates. Mirrors the use-mobile-nav store style:
 * sibling client components (sidebar button, topbar menu, orchestrator) share
 * one hook instead of a Context provider.
 *
 * `seen` is hydrated from localStorage once via hydrate() (called by the
 * orchestrator on mount). Initial state is an empty set so the server render
 * and first client render match — UI that depends on `seen` gates on
 * `hydrated` to avoid a flash.
 */

import { create } from 'zustand';
import { persistSeen, readSeen } from './seen';

type ProductUpdatesState = {
  panelOpen: boolean;
  activeTourId: string | null;
  seen: Set<string>;
  hydrated: boolean;
  hydrate: () => void;
  openPanel: () => void;
  closePanel: () => void;
  startTour: (id: string) => void;
  endTour: () => void;
  markSeen: (id: string) => void;
  markManySeen: (ids: string[]) => void;
};

export const useProductUpdates = create<ProductUpdatesState>((set, get) => ({
  panelOpen: false,
  activeTourId: null,
  seen: new Set(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ seen: readSeen(), hydrated: true });
  },
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  startTour: (id) => set({ activeTourId: id }),
  endTour: () => set({ activeTourId: null }),
  markSeen: (id) => {
    const seen = new Set(get().seen);
    seen.add(id);
    persistSeen(seen);
    set({ seen });
  },
  markManySeen: (ids) => {
    const seen = new Set(get().seen);
    for (const id of ids) seen.add(id);
    persistSeen(seen);
    set({ seen });
  },
}));
