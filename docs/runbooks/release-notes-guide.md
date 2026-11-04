# Release-notes guide — writing a "มีอะไรใหม่" release

**Audience:** whoever (person or Claude session) ships a change admins will
notice, or is asked to "announce", "add a changelog" or "tell admins what's new".

**Rewritten 2026-11-04**, replacing `changelog-release-entry.md` (2026-09-06),
and shipped with release `2026.11.1`. The page, pop-up, numbering and figures
below are built and tested — **do not rebuild any of it.** Your job is to feed it.

---

## 1. Why this page goes stale, and the rule that stops it

Between 6 Sep and 4 Nov 2026, 58 commits reached production and not one release
was written; admins learned about per-branch pay periods from chat. A system
nobody feeds looks exactly like a system nobody built.

**Rule: every deploy that changes what an admin or employee sees or is paid
either gets a release entry, or rolls into the next one.** Drafting the entry is
part of the deploy checklist, not an afterthought. Pure refactors, tests and
docs need none.

---

## 2. Version numbers

**`YYYY.MM.N`** — the year and month of the release date, then the month's
1st, 2nd, 3rd release. Example: `2026.11.1`, `2026.11.2`, `2026.12.1`.

| Question | Answer |
|---|---|
| Release or deploy? | A **release** is what we announce. Several deploys roll into one release. |
| When does N reset? | On the first release of a new month — back to `.1`. |
| Which year in the number? | Western (CE): it sorts, and it matches git. **Dates on screen** use the reader's calendar (Thai → พ.ศ.) via `formatDate`. |
| Small fixes? | No release of their own. List them as "แก้ไข" items in the next release. |
| Where does it show? | On the page, in the pop-up, and in the sidebar footer (`Koolman Work · 2026.11.1`), all from the registry — never hard-code it. |
| Git tag? | Tag the deploy commit `v2026.11.1` when you announce it. |

The rules are code: `versionProblems()` in `src/lib/product-updates/release.ts`
(format, month matches date, counts 1-2-3 with no gaps or repeats, later count
not dated earlier). `registry.test.ts` fails the build on any breach.

This replaces the 2026-09-06 decision "dated entries, no version numbers" —
the owner asked for version numbers on 2026-11-04. Do not switch back.

---

## 3. Anatomy of a release

In the order a reader needs it. The `UpdateItem` type
(`src/lib/product-updates/types.ts`) has one field per part.

| # | Part | Field | Rule |
|---|---|---|---|
| 1 | Version + date | `version`, `date` | See §2. |
| 2 | Title | `title` | **What admins can now do** — an outcome, not a feature name. One line. "สาขาตั้งรอบเงินเดือนและวันหยุดของตัวเองได้", not "Branch cut-off overrides". |
| 3 | Summary | `summary` | One or two sentences: what changed, who it reaches. Rich text allowed (§5). |
| 4 | Action needed | `action` | **Only when an admin must do something.** Starts with the date or a verb, names the menu path, says what happens if they don't. Always shown in the pop-up. At most one per release. |
| 5 | Lead figure | `figure` | The one picture that explains the release (§4). Optional. |
| 6 | Items | `items[]` | Each: `kind` (`new` / `improved` / `fixed`), `audience` (`admin` / `payroll` / `employee`), one-line `text`, optional `detail` naming the menu path, optional `figure`. Newest-impact first. Five is plenty; past eight, split the release. |
| 7 | Links | `links[]`, `tour` | In-app paths to the pages concerned; mark one `primary`. A `tour` only when there are real steps. |
| 8 | Sidebar version | — | Automatic: the newest release. |

**The pop-up** (`AnnouncementModal`) shows 1–4, "and N more changes" and the
tour button; "อ่านรายละเอียด" opens `/admin/whats-new`, which marks the batch
read (so the page can still show which releases were unread). It fires for any unseen entry with
`announce: true` and shows every unseen release in one batch.

`id` is the seen key: a fresh slug per release (`branch-settings-2026-11`),
**never renamed or reused** — renaming re-announces to everyone.

---

## 4. Figures — data, not pictures

A figure is a typed object rendered by `figures.tsx`. **Never put text inside an
image.** Six languages × two themes of one picture is twelve files to keep in
step; data renders in the reader's language and theme by itself, and HTML lets
long Burmese/Khmer labels wrap.

| Template | `kind` | Use it for | Example |
|---|---|---|---|
| Timeline | `timeline` | Periods or dates, when *when* is the point: pay periods, a switch-over month, a start date. | Central Audio's October running 27 Sep – 31 Oct. |
| Before → after | `beforeAfter` | A state that flips for some rows: who is off, who is charged, which setting applies. | 31 Dec: every branch off → only Central Audio off. |
| Steps | `steps` | Where to click, 3 steps (5 at most). Pair it with an action-needed box. | Settings › Holidays → Applies to → tick branches. |

Rules:
- **One lead figure per release.** An item or the action box may carry its own
  figure when it needs one; three figures in a release is the ceiling
  (`registry.test.ts` fails a fourth).
- Timeline bars are labelled automatically with the payroll month of their end
  date; add a short `note` only for the exception (`+5 วัน`). Tones: `muted`
  (unchanged), `brand` (the new normal), `highlight` (the one-off).
- Before → after rows are proper names (branches), so plain strings; the
  "หยุด / ทำงาน" labels come from `ui-text.ts`.
- Every figure takes an optional `caption`: say what the reader should notice,
  in one or two sentences.
- **Screenshots** are only for "the button is here", taken from the Thai UI
  with nothing drawn on them, and need a new figure kind first — none ships
  today on purpose. Try `steps` before reaching for a screenshot.
- A new template is a code change (`types.ts` + `figures.tsx` + this table),
  not a one-off in the registry.

---

## 5. Writing it

Audience: about eight Thai admins who skim, on desktop and phone. Write the
**Thai first** — it is the real audience — then English, then the other four.

- Plain words; name things by what is on screen ("ตั้งค่า › วันหยุด").
- Name the menu path in full, with `›` between levels.
- Numbers and dates the reader will check: say them exactly ("27 ก.ย. – 31 ต.ค.").
- No internal terms (override, migration, cut-off rule id, guard).
- Summary markup (`rich-text.ts`): `**bold**` for the one key term, `_italic_`,
  `==highlight==` at most once per entry, `- ` bullets (older entries use them;
  new ones put lists in `items` instead). No underline, no HTML.

**All six locales are mandatory** for every translated field — title, summary,
action, figure labels and captions, items, links. `i18n-completeness.test.ts`
walks the whole entry, so a missing one fails the build. `th`/`en` are
human-authored; `my`/`lo`/`zh-CN`/`km` may be AI-drafted (they are pending
native-speaker proofread — say so in the commit).

---

## 6. Checklist

1. **Confirm the cut**: which deploys this release covers. Ask the owner if unsure.
2. Add one entry to `src/lib/product-updates/registry.ts` (copy the newest one).
   Version per §2, fresh `id`, `announce: true` if it is worth interrupting for.
3. Run:
   ```bash
   npx vitest run src/lib/product-updates
   npx biome check src && pnpm typecheck
   ```
4. Look at it — **do not trust the tests alone**:
   - `pnpm dev`, log in as a local admin; the pop-up appears with version, title,
     summary and any action box;
   - "อ่านรายละเอียด" opens `/admin/whats-new`; the release reads top to bottom;
   - switch to dark mode and check every figure; switch language to English;
   - reload — the pop-up must not return; the sidebar footer shows the new version.
   To see the pop-up again, clear your local seen-set:
   ```sql
   update "User" set "productUpdatesSeen" = null where email = 'admin@koolman.local';
   ```
5. Commit with the entry, deploy, then tag: `git tag v2026.11.1 <deploy-sha>`.

---

## 7. Where it lives

```
src/lib/product-updates/
  registry.ts        <- THE RELEASES. The only file you normally edit.
  types.ts           <- UpdateItem, figures, items, links
  release.ts         <- version rules, sorting, timeline geometry
  ui-text.ts         <- chrome labels (six locales)
  rich-text.ts       <- summary markup
  selectors.ts, store.ts, actions.ts, tours.ts, run-tour.ts
src/components/admin/product-updates/
  whats-new-page.tsx     <- /admin/whats-new (version rail + cards)
  release-card.tsx       <- one release, and the pop-up teaser
  figures.tsx            <- the three figure templates
  announcement-modal.tsx <- the one-time pop-up
  product-updates.tsx    <- single mount: hydration + tours
src/app/(admin)/admin/whats-new/page.tsx  <- route, gated by requireAdminArea()
```

The sidebar's "มีอะไรใหม่" links to the page; it keeps
`data-tour="whats-new-button"` for the tours.

---

## Still true from the 2026-09-06 runbook

- **`announce` is a trigger, not a selector.** The pop-up shows every unseen
  release; `registry.test.ts` pins that no announce entry can be stranded.
- **Tour anchors live in the persistent shell** (topbar/sidebar) — `runTour`
  silently drops steps whose anchor is not on the current page.
  `registry.test.ts` fails the build if a tour names an anchor nothing renders.
- **No tour unless the feature has real steps.**
- Scrims use `--color-scrim`, never `bg-ink-*/<alpha>` (dark mode lightens
  those) — `globals.dark.test.ts` guards it.

## Related

- `docs/runbooks/deploy-rollback.md`
