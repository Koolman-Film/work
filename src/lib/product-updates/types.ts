/**
 * Product-updates content model (admin web).
 *
 * All content is code-shipped — these types describe the typed registry
 * devs edit per release. Copy is inline & localized; `th` is the source of
 * truth, `en` an optional proofread fallback target.
 */

export type LocalizedText = { th: string; en?: string };

export type UpdateItem = {
  /** Stable slug — the seen key. NEVER rename or reuse. */
  id: string;
  /** ISO date 'YYYY-MM-DD' — drives newest-first ordering. */
  date: string;
  title: LocalizedText;
  body: LocalizedText;
  /** When true, also interrupt with a modal until the user dismisses it. */
  announce?: boolean;
  /** Optional tour id — shows a "Take the tour" button on the item. */
  tour?: string;
};

export type TourStep = {
  /** Matches data-tour="<anchor>" on a real element. NOT a CSS selector. */
  anchor: string;
  title: LocalizedText;
  body: LocalizedText;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

export type Tour = { id: string; steps: TourStep[] };
