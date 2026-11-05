/**
 * Product-updates content model (admin web).
 *
 * All content is code-shipped — these types describe the typed registry
 * devs edit per release. Copy is inline & localized; `th` is the required
 * human-authored source and `en` is human-authored. `my`/`lo`/`zh-CN`/`km`
 * are AI-drafted (pending native-speaker proofread) and each falls back to
 * `th` via pickText when absent.
 *
 * How to write one: docs/runbooks/release-notes-guide.md.
 */

import type { Locale } from '@/lib/i18n/config';

/** Localized string: `th` required; every other supported locale optional. */
export type LocalizedText = { th: string } & Partial<Record<Exclude<Locale, 'th'>, string>>;

/** What a change is. Fixed icon + colour per kind, so readers learn it once. */
export type ChangeKind = 'new' | 'improved' | 'fixed';

/** Who a change reaches. `payroll` is separate from `admin` because "does this
 *  move money" is the first thing admins look for. */
export type Audience = 'admin' | 'payroll' | 'employee';

/**
 * A figure is DATA, rendered by a component — never an image with text in it.
 * Text baked into a picture would need six languages × two themes of the same
 * file; data renders in the reader's language and theme for free.
 */
export type ReleaseFigure = TimelineFigure | BeforeAfterFigure | StepsFigure;

/** Periods or dates as bars on one day scale (pay periods, a switch-over). */
export type TimelineFigure = {
  kind: 'timeline';
  /** Inclusive YYYY-MM-DD bounds of the drawn range. */
  from: string;
  to: string;
  rows: {
    label: LocalizedText;
    /** Each bar is labelled with the month of its `to` date, plus `note`. */
    segments: {
      from: string;
      to: string;
      tone: 'muted' | 'brand' | 'highlight';
      note?: LocalizedText;
    }[];
  }[];
  caption?: LocalizedText;
};

/** Who/what was in which state before and after. Rows are proper names
 *  (branches, people), so they are plain strings, not translated. */
export type BeforeAfterFigure = {
  kind: 'beforeAfter';
  before: { title: LocalizedText; rows: { label: string; off: boolean }[] };
  after: { title: LocalizedText; rows: { label: string; off: boolean }[] };
  caption?: LocalizedText;
};

/** Where to click, as numbered tiles. Three is the sweet spot; five at most. */
export type StepsFigure = {
  kind: 'steps';
  steps: { title: LocalizedText; detail: LocalizedText }[];
  caption?: LocalizedText;
};

export type ChangeItem = {
  kind: ChangeKind;
  audience: Audience;
  /** One line: the change, from the reader's side. */
  text: LocalizedText;
  /** Where to find it, or what exactly differs. Name the menu path. */
  detail?: LocalizedText;
  figure?: ReleaseFigure;
};

export type ReleaseLink = {
  label: LocalizedText;
  /** An in-app path such as /admin/settings/holidays. */
  href: string;
  primary?: boolean;
};

export type UpdateItem = {
  /** Stable slug — the seen key. NEVER rename or reuse. */
  id: string;
  /** `YYYY.MM.N`: year and month of `date`, N = this month's Nth release. */
  version: string;
  /** ISO date 'YYYY-MM-DD' — the release date. */
  date: string;
  /** What admins can now do — an outcome, not a feature name. One line. */
  title: LocalizedText;
  /** One or two sentences: what changed and who it reaches. Accepts the
   *  rich-text markup (rich-text.ts). Older entries carry bullets here. */
  summary: LocalizedText;
  /** Only when an admin must do something. Starts with the date or a verb
   *  and names the menu path. The pop-up always shows it. */
  action?: { text: LocalizedText; figure?: ReleaseFigure };
  /** The lead figure: the one picture that explains the release. */
  figure?: ReleaseFigure;
  items?: ChangeItem[];
  links?: ReleaseLink[];
  /** When true, also interrupt with a modal until the user dismisses it. */
  announce?: boolean;
  /** Optional tour id — shows a "Take the tour" button on the item. */
  tour?: string;
  /**
   * Written after the fact, from git history (2026-11-05 backfill). It is
   * part of the record on /admin/whats-new, but it is never unread: it adds
   * no sidebar dot, no "Unread" mark and never joins the pop-up — announcing
   * five months of past releases to someone who lived through them is noise.
   * Never combine with `announce`.
   */
  history?: true;
};

export type TourStep = {
  /** Matches data-tour="<anchor>" on a real element. NOT a CSS selector. */
  anchor: string;
  title: LocalizedText;
  body: LocalizedText;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

export type Tour = { id: string; steps: TourStep[] };
