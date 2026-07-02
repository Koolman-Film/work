# TODO — LIFF direct-entry re-architecture (one load per rich-menu tap)

**Status:** DEFERRED (evaluated 2026-07-02, not yet started)
**Goal:** Make a rich-menu tap open the destination LIFF page in **one** page load
instead of the current two (`/liff/pair` bootstrap → redirect → destination).

> Read this whole doc before starting. The change re-architects how *every*
> employee authenticates into LIFF and requires a LINE-console change + on-device
> testing. It is NOT a quick edit.

---

## Why (the problem)

Today, **every** rich-menu tap funnels through the single LIFF endpoint
`/liff/pair`, which runs `liffBootstrap()` (liff.init + Supabase sign-in) and then
does a **full-page redirect** to the destination. Admin destinations then re-check
the session via `LiffSessionGate`. So every tap is **two full page loads**, even
with a warm session — that's the "multiple refresh" the user sees.

Already shipped (partial mitigations, keep these):
- Neutral loader on `/liff/pair` (no "Link your LINE account" heading on nav) — `pair-client.tsx`.
- Skip the `getUser()` stale-check round-trip on `?dest=` navigation — `src/lib/liff/init.ts` (`isNavigation`).

These make each tap snappier but **do not remove the second load**. Only the
re-architecture below does.

---

## The key LIFF mechanic

LIFF **path concatenation**: opening `https://liff.line.me/{liffId}/some/path`
resolves to `{ENDPOINT_URL}` + `/some/path` (path & query appended, encoded via
`liff.state` on the primary redirect). Confirmed at
https://developers.line.biz/en/docs/liff/opening-liff-app/

So to open `/liff/admin/inbox` directly, the **LIFF endpoint URL** (LINE console)
must be the `/liff/` base — today it is `/liff/pair`, which is why everything
funnels there. There is **one** endpoint per LIFF app, so this is all-or-nothing.

---

## Target design (backward-compatible)

1. **LINE console:** change LIFF Endpoint URL from `https://work.kool-man.com/liff/pair`
   → `https://work.kool-man.com/liff` (or `/liff/`). *(Manual, user-only step.)*
2. **Shared session gate** in `(liff)/layout.tsx` — a generalized version of the
   admin `LiffSessionGate` that runs `liffBootstrap()` for **every** `/liff/*`
   page (fast-path when a warm `custom:line` session exists; bootstrap + `router.refresh()`
   when cold). Remove the admin-only gate afterward.
3. **`/liff` root = backward-compat dispatcher.** Existing already-sent links
   (`?liff.state=?dest=…`, `?pair=…`, `?pairAdmin=…`, `?merge=…`) will now land on
   `/liff?...`. Keep the current `pair-client.tsx` dispatch/binding logic reachable
   at the root so those OLD links keep working. **Do not delete `/liff/pair`'s logic.**
4. **Rich menus:** recreate the 3 menus with **direct-path** URIs
   (`https://liff.line.me/{liffId}/admin/inbox`, `/liff/check-in`, etc.) instead of
   `?liff.state=?dest=…`. Update the 3 `*_RICH_MENU_ID` env vars, re-link all users
   (bulk-link), delete old menus. (Same recreate+relink cycle done twice already.)
5. **Token-binding stays funneled.** `?pair` / `?pairAdmin` / `?merge` must still hit
   a page that validates the JWT + does the DB bind — the shared gate must not
   consume/short-circuit those. Simplest: those links keep landing on the root
   dispatcher (or a dedicated `/liff/bind`).
6. **Proxy** (`src/proxy.ts`): every `/liff/*` page becomes a possible sessionless
   entry, so they must NOT bounce to `/login` — the shared gate handles auth. Widen
   the `PUBLIC_INSIDE_PROTECTED` carve-out accordingly. **Security-sensitive** —
   review carefully (don't accidentally expose a non-LIFF route).

---

## Concrete change list (files)

| # | File | Change |
|---|------|--------|
| 1 | `src/app/(liff)/layout.tsx` | Wrap children in a new shared `LiffSessionGate` (bootstrap on every page). |
| 2 | `src/app/(liff)/liff/admin/liff-session-gate.tsx` | Generalize → move to a shared location; keep the fast-path + `router.refresh()`. |
| 3 | `src/app/(liff)/liff/admin/layout.tsx` | Remove the admin-only `<LiffSessionGate>` wrap (now in the (liff) layout). |
| 4 | `src/app/(liff)/liff/pair/pair-client.tsx` + `pair/page.tsx` | Keep as the backward-compat dispatcher for legacy `?liff.state` links; ensure the root `/liff` also serves it (or re-point). |
| 5 | `src/lib/liff/init.ts` | Ensure `liffBootstrap()` is safe to run from the shared gate on binding pages (don't clobber a `?pair` flow). Keep the `isNavigation` getUser-skip. |
| 6 | `src/proxy.ts:37` | Update `PUBLIC_INSIDE_PROTECTED` so sessionless `/liff/*` first-hits aren't 307'd to `/login`. |
| 7 | `scripts/setup-rich-menus.ts` | Change area URIs from `funnel('?dest=x')` to the direct-path form `liff.line.me/{liffId}/<path>`. Recreate menus, update env, re-link, delete old. |
| 8 | `src/lib/line/flex-templates.ts` | Push-notification deep links: optionally move to direct-path too (else they keep funneling through the root dispatcher — fine for backward compat). Note: line ~148 already builds a plain `${appBaseUrl}/liff/leave/${id}` that does NOT funnel — verify it works post-change. |
| 9 | `src/app/i/[token]/page.tsx`, `src/lib/auth/admin-line-pairing-actions.ts`, `src/lib/auth/start-admin-merge.ts` | Token links (`?pair/?pairAdmin/?merge`) — keep funneling to the dispatcher/bind route. |

Full LIFF page inventory + session dependency is in the analysis (see "All LIFF
pages" below).

---

## Risks (why it's not "quick")

1. **Auth entry for the whole LIFF surface changes — including check-in.** Employee
   pages (`check-in`, `leave`, `advance`, `profile`, `payslip`, `calendar`, `summary`,
   `home`) currently have **no** client gate; they trust the funnel. Moving them to
   self-bootstrap changes how the most-used flow authenticates. A bug = check-in
   breaks for everyone.
2. **Endpoint change flips ALL links at once** and is a LINE-console edit only the
   user can make. Can't be staged/rolled-back gradually. Backward-compat dispatcher
   at `/liff` is the safety net for already-sent push/QR links.
3. **Cannot be verified without a real LINE device.** tsc/tests pass ≠ it works in
   LINE's webview + endpoint resolution. Irreducible "test-live" risk on a
   login-critical path.

**Mitigations:** keep `/liff/pair` (or `/liff` root) as a working dispatcher so old
links never break; ship behind a careful device-test pass (check-in + an admin page
+ a fresh pairing + a merge) immediately after deploy; be ready to revert the
console endpoint URL if check-in breaks.

---

## Manual / ops steps (not code)

- [ ] Change LIFF Endpoint URL in LINE Developers console (`/liff/pair` → `/liff`).
- [ ] On-device test: employee check-in (warm + cold), an admin page, first-time
      pairing via `/i/[token]`, admin self-pair, merge QR.
- [ ] Recreate 3 rich menus with direct-path URIs → set env → `sync` re-link → delete old.
- [ ] Confirm an already-sent push-notification link still opens (backward compat).

---

## Checklist (do in this order)

- [ ] Shared `LiffSessionGate` in `(liff)/layout.tsx` (generalize the admin one).
- [ ] Make `/liff` root serve the dispatcher/binding logic (backward compat).
- [ ] Update `proxy.ts` carve-outs (security review).
- [ ] Remove the admin-only gate wrap.
- [ ] Recreate rich menus with direct-path URIs + env + relink + delete old.
- [ ] Deploy → user changes console endpoint → device-test pass.
- [ ] Update push/QR builders to direct-path (optional; keep dispatcher as fallback).

---

## Reference — LIFF page inventory (session dependency, as of 2026-07-02)

Employee pages (server `requireEmployee()`, **no** client gate, assume funnel):
`/liff/check-in`, `/liff/leave` (+`[id]`,`/new`), `/liff/advance` (+`[id]`,`/new`),
`/liff/calendar`, `/liff/profile`, `/liff/payslip`, `/liff/summary`.
`/liff/home` uses `requireRole(['Staff','Admin','Superadmin'])`.

Admin pages (server `requireLiffAdmin()` **and** `LiffSessionGate` client fallback):
`/liff/admin/dashboard`, `/liff/admin/inbox`, `/liff/admin/reports`,
`/liff/admin/leave/[id]`, `/liff/admin/advance/[id]`.

Key files: `src/lib/liff/init.ts` (liffBootstrap), `src/app/(liff)/liff/admin/liff-session-gate.tsx`,
`src/app/(liff)/liff/admin/layout.tsx:16`, `src/app/(liff)/layout.tsx`,
`src/app/(liff)/liff/pair/{page,pair-client}.tsx`, `src/proxy.ts:25-89`,
`scripts/setup-rich-menus.ts`, `src/lib/line/flex-templates.ts`.

Rich-menu / deep-link builders (all currently `?liff.state=…`):
- `src/app/i/[token]/page.tsx:63-89` — employee pair QR (`?pair=`)
- `src/lib/auth/admin-line-pairing-actions.ts:73-76` — admin pair (`?pairAdmin=`)
- `src/lib/auth/start-admin-merge.ts:60-63` — merge QR (`?merge=`)
- `src/lib/line/flex-templates.ts:76-80,246-250,284-289` — push deep links (`?dest=`)
- `scripts/setup-rich-menus.ts:42-101` — rich-menu tap URIs (`?dest=`)

See also the all-dynamic rich-menu runbook: `docs/superpowers/plans/2026-07-02-all-dynamic-rich-menus.md`
and memory note `koolman-line-rich-menu-ops`.
