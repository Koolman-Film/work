# All-dynamic capability rich menus — cutover runbook

**Date:** 2026-07-02
**Branch:** `feat/capability-rich-menu`

## Model

Three account types, each sees a different LINE rich menu, linked **per-user by
capability**. There is **no OA default menu** (removed from the LINE console) —
every LINE-bound user is explicitly linked, or unlinked to a blank bar.

| Capability | Menu | Env id |
|---|---|---|
| employee only (Staff, active Employee) | employee (check-in / leave / advance / calendar) | `EMPLOYEE_RICH_MENU_ID` |
| admin only (email, admin/superadmin tier) | admin (inbox / advance-slip / admin web) | `ADMIN_RICH_MENU_ID` |
| admin **and** employee | combined (6 buttons) | `COMBINED_RICH_MENU_ID` |
| none / archived user / archived employee | unlink (blank bar) | — |

The single path to admin+employee is the **merge** flow (admin picks their
employee → employee scans QR → confirm). The employee-edit "grant admin" button
was removed (2026-07-01 incident follow-up).

## Code (this branch)

- `src/lib/line/rich-menu.ts` — `computeMenuTarget` (4 targets incl. `employee`),
  `resolveCapabilities` (archived user **or** archived employee → no capability),
  `menuIdForTarget`, `syncRichMenuForUser` (best-effort, never throws).
- Sync call sites — menu always follows capability:
  - employee LINE bind (`link-line-to-employee.ts`)
  - admin LINE bind (`link-line-to-admin.ts`)
  - merge (`merge-admin-into-employee.ts`)
  - role grant / revoke (`settings/team/actions.ts`)
  - admin archive (`settings/team/actions.ts` → unlink)
  - employee archive (`employees/actions.ts` → re-sync)
  - employee LINE unlink (`employees/actions.ts` → unlink before clearing binding)
- `scripts/setup-rich-menus.ts <employee|admin|combined> <image>` — creates one
  menu object with `selected:false`, prints its env id.
- `scripts/sync-rich-menus.ts [--apply]` — reconcile sweep; reuses
  `syncRichMenuForUser` (identical policy). Backfill + repair tool.

## Cutover (ordering matters — no blank-menu gap)

1. **Merge + deploy** this branch to production (code is inert until the env ids
   are set — `syncRichMenuForUser` warns and skips when an id is missing).
2. **Create the three menu objects** (needs `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
   + `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_LIFF_ID`):
   ```
   vercel env pull .env.production
   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts employee ./assets/rich-menu/final/menu-employee.png
   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts admin    ./assets/rich-menu/final/menu-admin.png
   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts combined ./assets/rich-menu/final/menu-combined.png
   ```
3. **Set the three env ids** in Vercel (Production): `EMPLOYEE_RICH_MENU_ID`,
   `ADMIN_RICH_MENU_ID` (already set — keep/replace), `COMBINED_RICH_MENU_ID`.
   Redeploy so the runtime picks them up.
4. **Backfill first** — link the right menu onto every already-paired user:
   ```
   dotenv -e .env.production -- tsx scripts/sync-rich-menus.ts          # dry-run, review the plan
   dotenv -e .env.production -- tsx scripts/sync-rich-menus.ts --apply
   ```
   This also repairs the 2026-07-01 incident (three users un-archived with a
   stale admin-menu link) — they resolve to `employee` and get relinked.
5. **Only now remove the OA default menu** in the LINE console (Messaging API →
   Rich menus → clear default), or `DELETE https://api.line.me/v2/bot/user/all/richmenu`.
   Doing this before step 4 would leave paired employees with a blank bar.

## Failure mode to accept

All-dynamic has no default fallback: a failed per-user link = blank menu for
that employee (no check-in button) until re-synced. Mitigation: `sync-rich-menus.ts`
is the repair tool — re-run `--apply` any time menus drift. Consider a periodic
cron once volume grows.

## Not done (follow-ups)

- Deleting the old OA default menu is a manual console action (step 5).
- Root-branch placeholder `assets/rich-menu/menu-*.svg/png` are the design
  sources; `final/*.png` are what setup uploads.
