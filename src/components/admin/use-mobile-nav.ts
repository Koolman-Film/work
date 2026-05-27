/**
 * Tiny Zustand store for the mobile sidebar drawer's open/closed state.
 *
 * Why Zustand instead of Context: the Topbar (which owns the hamburger
 * button) and the Sidebar (which is the drawer) are sibling Client
 * Components under a Server-Component layout. A Context provider would
 * require wrapping both in a new Client boundary — Zustand sidesteps
 * that entirely. Both components import the same hook, no plumbing.
 *
 * The store has no SSR concerns: drawer state is meaningless before
 * hydration anyway (initial render always shows it closed).
 */

import { create } from 'zustand';

type MobileNavState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
};

export const useMobileNav = create<MobileNavState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
