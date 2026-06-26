# List Pagination — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming → implementation)

## Problem

Record lists (คำขอลา, คำขอเบิก, พนักงาน, …) have grown long in production. Worse
than a UX annoyance, the list queries are hard-capped (`take: 50` on LIFF
employee lists, `take: 100` on admin inboxes, **no cap** on the employees list)
with **no offset** — so records beyond the cap are *completely unreachable*.

Stated goals (all selected): reach old records, faster page load, less
scrolling, and find a specific record.

## Approach: offset pagination via URL params

Chosen over cursor/"load more" because the app is pure **Next.js App Router
server components + Prisma + URL-param state** (the admin status filters already
work this way). Offset pagination:

- Adds **zero** new client components / server actions for the core.
- Is jumpable and bookmarkable — directly serves "reach old records" and pairs
  naturally with search for "find a specific record".
- Offset's only real weakness (deep-page cost + a `count()` per page) is
  irrelevant at HR-app scale, and the tables are already indexed.

## Shared core

- `src/lib/pagination.ts` — `PAGE_SIZE` (20), `parsePageParam`, `pageArgs`
  (`{ skip, take }`), `buildPageMeta(total, page)` → clamped `PageMeta`.
- `src/components/ui/pagination.tsx` — server component: Prev / "หน้า X / Y" /
  Next. Renders nothing when `pageCount <= 1`. Takes a `makeHref(page)` callback
  so each page preserves its own params; Thai labels by default, overridable for
  i18n (LIFF).
- `src/components/ui/list-search.tsx` — URL-driven name search box (submits on
  Enter, resets to page 1, preserves the params passed in `keep`). Admin inboxes
  only.

Per page, `findMany({ take: N })` becomes:

```ts
const [rows, total] = await Promise.all([
  prisma.X.findMany({ where, orderBy, ...pageArgs(page), select }),
  prisma.X.count({ where }),
]);
const meta = buildPageMeta(total, page);
```

## Per-list changes

| List | Page size | Search | Notes |
|------|-----------|--------|-------|
| `/liff/leave` | 20 | — | i18n labels; header count → `meta.total` |
| `/liff/advance` | 20 | — | i18n labels; count query mirrors `where` (employeeId + deletedAt:null) |
| `/admin/leave` | 20 | name (`q`) | Thai labels; count via `prisma`/`prismaRaw` to match the active client (trash uses raw); chips + search preserve each other and reset page |
| `/admin/advance` | 20 | name (`q`) | same as leave |
| `/admin/employees` | 20 | (existing) | add pagination only; existing q/branch/dept/status filters preserved across pages |

Status filter chips link to page 1 (switching context resets the page). Search
preserves the active status; switching status preserves the active search.

## i18n

New `pagination` namespace (`prev`, `next`, `pageOf`) added to all six message
files (th, en, km, lo, my, zh-CN). Admin pages are hardcoded Thai and use the
component defaults.

## Out of scope

Cursor/infinite scroll; sortable columns; search on LIFF lists; saved filters.
