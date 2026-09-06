# Runbook — announcing a release in the What's New changelog

**Audience:** whoever (person or Claude session) is asked to "add a changelog",
"tell admins what's new", or "announce the new version".

**Written 2026-09-06** after a session nearly rebuilt this system from scratch.

---

## STOP. It already exists. Do not build it again.

Every part of a changelog + one-time announcement + feature tour is **already
built, tested and deployed**. If you are reading this because someone asked for
a changelog dialog, the answer is not to write one.

| What you were probably asked for | What already exists |
|---|---|
| A dialog users can open to see changes | `WhatsNewPanel` — opens from **มีอะไรใหม่** at the bottom of the admin sidebar |
| A one-time popup on a new version | `AnnouncementModal` — fires for any entry with `announce: true` |
| Show it only once per user | `User.productUpdatesSeen` (Json column), server-hydrated so it cannot flash |
| A tour of the new features | `tours.ts` + `run-tour.ts` (driver.js), attached per entry via `tour: '<id>'` |
| Tests | `store`, `selectors`, `actions`, `seen-json`, `i18n-completeness`, `registry`, `rich-text`, `ui-text` |

**Why it looked missing until 2026-09-06:** the registry held exactly ONE entry,
`welcome-2026-06`, from June 2026, and every admin had dismissed it. So the
sidebar dot never lit and no modal ever fired. A feature nobody feeds is
indistinguishable from a feature nobody built. It now holds three entries.

### Where it lives

```
src/lib/product-updates/
  registry.ts      <- THE CHANGELOG. This is the only file you normally edit.
  rich-text.ts     <- the bullet/bold/italic/highlight markup bodies may use
  types.ts         <- UpdateItem shape
  selectors.ts     <- nextAnnounce / unseenItems / unseenCount
  store.ts         <- zustand: seen set, panelOpen, activeTourId
  actions.ts       <- persists the seen-set to User.productUpdatesSeen
  tours.ts         <- tour definitions (anchors are data-tour="...", NOT selectors)
src/components/admin/product-updates/
  product-updates.tsx    <- single mount, owns hydration + tour running
  announcement-modal.tsx <- the one-time popup (every UNSEEN entry)
  whats-new-panel.tsx    <- the openable changelog (the FULL history)
  update-list.tsx        <- the rows both surfaces share; owns the scroll
```

Mounted once in `src/app/(admin)/layout.tsx` as `<ProductUpdates initialSeen={…} />`.

---

## Decisions already made (2026-09-06) — do not re-litigate

- **Dated entries, no version numbers.** Entries sort by `date`, newest first.
  The user explicitly chose this over semantic versions. The sidebar footer's
  "Koolman Work · V1" is unrelated decoration.
- **One entry per release, not added/changed/fixed groups.** The audience is
  eight Thai admins; nobody reads a bullet list of 24 commits.
- **No tour unless the feature has real steps.** Spending a tour on "here is a
  button" trains people to dismiss the tours that matter.

### `announce` is a trigger, not a selector (settled 2026-09-06)

The modal shows **every unseen entry**, in one scrollable list. `announce`
only answers "is this release worth interrupting for" — any number of entries
may carry it, and they all arrive together.

It was briefly the other way round: the modal rendered `nextAnnounce`, a single
item. That could not survive two entries landing at once — it showed the newest,
then either popped a second time the instant the first closed, or lost the other
entirely if the reader took **ดูทั้งหมด** (which marks everything seen on the
way out). Which of the two you got depended on which button you clicked. The
batch modal removes the choice, and with it the bug. `registry.test.ts` pins
that no announce entry can be stranded.

The panel still shows the **full history**; the modal shows only what is new to
that reader. That is the whole difference between the two surfaces now — they
share `UpdateList` for everything else.

### Tour anchors must live in the persistent shell

`runTour` resolves `data-tour` anchors against whatever page the reader is
standing on and **silently drops the steps it cannot find**. Tours start from
the panel, which opens anywhere, so a step anchored to a page element vanishes
for most readers. Anchor to topbar/sidebar only. `registry.test.ts` fails the
build if a tour names an anchor that no `.tsx` renders — a guard that exists
because `theme-toggle` had no anchor until the tour needed one.

---

## How to add an entry

### 1. Ask for the cutoff date

The user said they will tell you when to cut a release. Do not guess it and do
not use "today" unless they say so.

### 2. Add ONE entry to `registry.ts`

```ts
{
  id: 'ui-refresh-2026-09',      // stable slug, NEVER renamed or reused —
                                  // it is the seen key. Renaming re-announces
                                  // to everyone who already dismissed it.
  date: '2026-09-06',             // ISO. Drives ordering.
  title: { th: '…', en: '…', my: '…', lo: '…', 'zh-CN': '…', km: '…' },
  body:  { th: '…', en: '…', my: '…', lo: '…', 'zh-CN': '…', km: '…' },
  announce: true,                 // pops the modal once per admin
  // tour: 'some-tour-id',        // omit unless there are real steps
},
```

**All six locales are mandatory.** `i18n-completeness.test.ts` asserts every
locale key is a non-empty string, so a missing one fails the build, not
production. Write the Thai first (that is the real audience), then the rest.

Copy tone from `welcome-2026-06`: plain language, no jargon, name the thing so
people can find it ("ปุ่มสลับโหมดมืดอยู่มุมขวาบน").

### 3. Format the body so it can be skimmed

Bodies accept a small markup, parsed by `rich-text.ts` (not markdown, not a
dependency — four constructs and a token tree, never HTML):

```
- bullet          a line starting with "- "; consecutive lines form one list
**bold**          strong — use it for the lead-in word of each bullet
_italic_          emphasis
==highlight==     a brand-tinted chip; at most ONE per entry
```

Lead with one sentence of prose, then bullet the rules. Eight admins skim; they
do not read a paragraph. `registry.test.ts` fails the build on an unmatched
delimiter (which would otherwise render as literal asterisks) and on a second
highlight in one entry.

There is deliberately **no underline**: on the web an underline reads as a
link, and a modal full of real buttons is the worst place to teach people
otherwise.

### 4. Verify

```bash
npx vitest run src/lib/product-updates      # i18n completeness + selectors
npx biome check src && pnpm typecheck
```

Then open it in the running app — **do not trust the tests alone**:

1. `pnpm dev`, log in as admin
2. The modal should appear on first load after the entry lands
3. Dismiss it, reload — it must NOT come back
4. Click **มีอะไรใหม่** in the sidebar — the panel lists both entries, newest first

To re-test the popup, clear the seen-set for your user:

```sql
update "User" set "productUpdatesSeen" = null where email = 'admin@koolman.local';
```

---

## Fixed 2026-09-06 — modal scrims washed the page pale in dark mode

`bg-ink-1/40` was used as a backdrop in `ui/dialog.tsx` and
`admin/sidebar.tsx`. `--color-ink-1` is `#0f172a` in light but `#e9f0f9` in
dark, so the scrim *lightened* the page instead of dimming it.

Fixed in `a332845` by adding a `--color-scrim` token that stays near-black in
both themes, seeded with light-mode `ink-1` so light rendering is provably
unchanged. `globals.dark.test.ts` now asserts the token is declared exactly
once, is not redefined by either dark block, and that no component reintroduces
a `bg-ink-*/<alpha>` fill.

Leaving the lesson here because it recurs: a token whose light-mode meaning is
"a step toward the ink" cannot simply be flipped for dark. The contrast e2e
suite cannot catch it — that suite walks pages at rest, and a scrim only exists
while a dialog is open.

---

## Shipped 2026-09-06

Two entries and one tour, in `1732f5d`'s successor:

- `auto-absence-2026-09` (`announce: true`, no tour) — payroll starts charging
  derived absences from 27 Sep. This is the one that interrupts.
- `ui-refresh-2026-09` (no announce, `tour: 'ui-refresh'`) — dark mode,
  readability, row-action buttons.
- `ui-refresh` tour: theme toggle → notification bell → What's New, all
  shell-anchored. Added `data-tour="theme-toggle"` to `topbar.tsx` (wrapping,
  not annotating, `ThemeToggle` — that component is shared with LIFF).
- Batch announcement modal + shared `UpdateList` + `rich-text.ts` markup.
- driver.js chrome localized (`nextBtnText`/`prevBtnText`/`doneBtnText`/
  `progressText` in `run-tour.ts`); `ui-text.test.ts` guards the template
  placeholders.

Verified in the browser in both themes: modal fires once, dismissal survives a
reload, no second modal stacks, panel lists all three newest-first, all three
tour steps resolve.

### Still worth doing

- `/admin/tools/absence-preview` is reachable only by typing the URL — nothing
  in the sidebar links it. The auto-absence entry therefore cannot point admins
  at the page that would let them check the derivation before payday.
- The What's New panel prints `item.date` raw (`2026-09-02`), while the rest of
  the Thai UI renders Buddhist-era dates via `src/lib/i18n/format.ts`.

## Related

- `docs/runbooks/deploy-rollback.md` — how to back this out
- `.remember/remember.md` — current deploy state and the theme-work context
