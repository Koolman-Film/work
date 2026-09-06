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
| Tests | `store`, `selectors`, `actions`, `seen-json`, `i18n-completeness` |

**Why it looks missing:** the registry has exactly ONE entry, `welcome-2026-06`,
from June 2026. Nobody has added a second one since. A feature nobody feeds is
indistinguishable from a feature nobody built.

### Where it lives

```
src/lib/product-updates/
  registry.ts      <- THE CHANGELOG. This is the only file you normally edit.
  types.ts         <- UpdateItem shape
  selectors.ts     <- nextAnnounce / unseenItems / unseenCount
  store.ts         <- zustand: seen set, panelOpen, activeTourId
  actions.ts       <- persists the seen-set to User.productUpdatesSeen
  tours.ts         <- tour definitions (anchors are data-tour="...", NOT selectors)
src/components/admin/product-updates/
  product-updates.tsx    <- single mount, owns hydration + tour running
  announcement-modal.tsx <- the one-time popup
  whats-new-panel.tsx    <- the openable changelog
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

### 3. Verify

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

## Known bug to fix while you are here (found 2026-09-06, NOT yet fixed)

**Modal scrims wash the page pale in dark mode.**

Two sites use `bg-ink-1/40` as a backdrop:

- `src/components/ui/dialog.tsx:115` — every modal in the app
- `src/components/admin/sidebar.tsx:257` — the mobile drawer backdrop

In light, `--color-ink-1` is `#0f172a`, so the scrim dims correctly. In dark it
is `#e9f0f9` — near-white — so the scrim *lightens* the page behind the modal
instead of dimming it. Reproduce by opening the What's New panel in dark mode.

**Fix:** add a `--color-scrim` token that stays near-black in BOTH themes (a
scrim's job is to dim regardless of theme) and point both sites at it. Seed the
light value with today's exact `ink-1` at 40% so light mode is provably
unchanged.

This is the **seventh** instance of the inversion trap described in the theme
notes: a token whose light-mode meaning is "a step toward the ink" cannot simply
be flipped. The contrast e2e suite cannot catch it — that suite walks pages at
rest, and a scrim only exists while a dialog is open.

---

## Suggested prompt for the next session

Paste this:

> Add a changelog entry announcing the UI refresh, cut off at <DATE>.
>
> Read `docs/runbooks/changelog-release-entry.md` FIRST — the What's New system
> already exists and must not be rebuilt. You are adding one entry to
> `src/lib/product-updates/registry.ts`, not writing a feature.
>
> Also fix the modal scrim bug documented in that runbook (`bg-ink-1/40` turns
> into a white haze in dark mode). Do that as its own commit — it touches every
> modal in the app, not just this one.
>
> The entry should cover: dark mode with a Light/Dark/System toggle, and
> readability improvements across the app. One entry, `announce: true`, no tour.
> Thai first, then the other five locales.
>
> Before finishing, open it in the browser in BOTH themes and confirm: the modal
> appears once, does not return after dismissal, and the page behind it gets
> darker rather than paler.

### Also worth telling that session

- **Test the second-entry path end to end.** `nextAnnounce` is unit-tested, but
  the real path — an admin with a populated `productUpdatesSeen` meeting a new
  entry — has never run in production. It is about to, for eight real people.
  That is exactly the shape of defect this codebase keeps producing: correct
  logic, untested range.
- Suggested test: an integration test asserting that a user who has already seen
  `welcome-2026-06` is announced the new entry.

---

## Related

- `docs/runbooks/deploy-rollback.md` — how to back this out
- `.remember/remember.md` — current deploy state and the theme-work context
