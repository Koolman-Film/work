# Translate native-language reasons (Google Cloud Translate)

**Date:** 2026-06-26
**Status:** Approved — ready for implementation

## Problem

Staff submit free-text leave reasons (and other notes) in their native
language — Burmese, Lao, Khmer, etc. — see the leave-review modal. Koolman
admins are mostly Thai and cannot read these. They need a way to translate
native text to Thai on demand.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Provider | **Google Cloud Translation API v2** (REST + API key). Auto-detects source language. |
| When / caching | **On-demand**, triggered by an admin click; **cache the result in the DB** so repeat views are free + instant. |
| Scope | **Reusable everywhere** — a generic `<TranslatableText>` + shared server action, wired into the leave modal first, then other native-language spots. |
| Display | **Show both** — keep the original text, append the Thai translation below with a "translated by Google" caption. |
| Cache shape | **Generic translation-cache table** keyed by a hash of the source text — NOT per-field columns. Serves any field with one migration. |
| Auth gate | **Authentication-only** (`requireRole(['Staff','Admin','Superadmin'])`). A `leave.read` gate would break reuse outside leave; the gate exists only to stop anonymous abuse of the paid API. |

## Architecture

Five well-bounded units:

### 1. Provider client — `src/lib/translate/google.ts`
Thin wrapper over Google Cloud Translation API v2. Pure I/O, no DB.
- `translateOnce(text: string, target: string): Promise<{ translatedText: string; detectedSourceLang: string }>`
- `POST https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_API_KEY}`
  with body `{ q: text, target, format: 'text' }`.
- Reads `data.translations[0].translatedText` and `.detectedSourceLanguage`.
- Throws a typed `TranslateError` on missing key, non-200, or malformed body.
- HTML-entity-decodes the response (`&#39;` → `'`) — the API returns entity-escaped text even with `format: 'text'`.

### 2. Cache table — Prisma model `Translation`
```prisma
model Translation {
  id                 String   @id @default(uuid()) @db.Uuid
  sourceHash         String   // sha256 hex of normalized source text
  targetLang         String   // e.g. "th"
  sourceText         String
  translatedText     String
  detectedSourceLang String
  createdAt          DateTime @default(now())

  @@unique([sourceHash, targetLang])
}
```
No changes to `LeaveRequest`. One migration. Normalization before hashing:
`text.trim()` (so trailing-whitespace variants share a cache row); the hash is
`sha256(normalizedText)` — source text only; uniqueness is the
`(sourceHash, targetLang)` pair, so the same source can be cached per target.

### 3. Server action — `src/lib/translate/actions.ts`
```ts
'use server';
export async function translateText(
  text: string,
  targetLang = 'th',
): Promise<{ translatedText: string; detectedSourceLang: string; cached: boolean }>
```
Flow:
1. `await requireRole(['Staff', 'Admin', 'Superadmin'])` — authenticated only.
2. Guard: empty/whitespace `text` → return `{ translatedText: '', detectedSourceLang: '', cached: false }` (component won't call it for empty anyway).
3. Normalize + hash → `prisma.translation.findUnique({ where: { sourceHash_targetLang } })`.
4. **Hit** → return cached `{ ..., cached: true }`.
5. **Miss** → `translateOnce` → `prisma.translation.create(...)` (swallow unique-constraint races by re-reading) → return `{ ..., cached: false }`.

### 4. Reusable client component — `src/components/ui/translatable-text.tsx`
```tsx
<TranslatableText text={row.reason} className="..." />
```
- Renders original `text` with `whitespace-pre-wrap`.
- If `text` is empty/whitespace → render nothing extra (no button).
- A subtle button **"แปลเป็นไทย"** beneath the text.
- On click → `useTransition`/local `useState` → call `translateText(text)`:
  - loading → button shows spinner + disabled.
  - success → render Thai below original, caption **"แปลโดย Google · จากภาษา {lang}"**.
  - `detectedSourceLang === 'th'` → show **"ข้อความเป็นภาษาไทยอยู่แล้ว"** instead of a duplicate.
  - error → inline **"แปลไม่สำเร็จ — ลองใหม่"** with retry; original always stays visible.
- Labels pulled from `messages/th.json` under a new `translate` namespace.

### 5. Wire-in
- `leave-review-modal.tsx`: wrap `row.reason` (employee reason). Also wrap
  `reviewNote` and any `deleteReason` display where a native note can appear.
- `leave/page.tsx:245` `deleteReason` display → same component.
- Future native-language spots adopt the same component (no new backend work).

## Data flow

```
admin clicks "แปลเป็นไทย"
  → translateText(text) [server action]
      → requireRole (authn)
      → hash(text, 'th')
      → cache lookup
          hit  → return cached
          miss → Google API → persist → return
  → component renders Thai below original
```

## Error handling

- Missing `GOOGLE_TRANSLATE_API_KEY` → `TranslateError` → inline retry message.
- Network / non-200 from Google → `TranslateError` → inline retry message.
- Unique-constraint race on concurrent first-translate → catch, re-read cache, return.
- Original text is never hidden, so a failed translation degrades gracefully.

## Configuration

- New env var `GOOGLE_TRANSLATE_API_KEY` (server-only — never `NEXT_PUBLIC_`).
- Add to `.env.example` with a comment pointing at the GCP "Cloud Translation API" key.

## Testing

- **Unit `google.test.ts`** — mocked `fetch`: maps a well-formed response;
  entity-decodes; throws on non-200 and on missing key.
- **Unit `actions.test.ts`** — mocked Prisma + mocked `translateOnce`:
  cache hit returns without calling Google; cache miss calls Google then persists;
  empty input short-circuits; authn is required; P2002 race re-reads the cache.
- **Unit `hash.test.ts`** — `sourceHashFor` is a stable lowercase sha256 that
  trims surrounding whitespace.
- **Unit `translatable-text.helpers.test.ts`** — the component's real logic
  lives in pure helpers (`languageNameTh`, `isAlreadyTarget`) tested in the node
  env. The repo has no React-component test harness (UI is covered by e2e/manual,
  per `vitest.config.ts`), so we deliberately did NOT introduce happy-dom; the
  thin React shell (button → loading → shows-both / already-Thai / error) is
  verified manually + e2e.

## Out of scope (YAGNI)

- Auto-translating on submit (rejected in brainstorming — pays for unread reasons).
- Editing/overriding machine translations.
- Caching eviction/TTL (translations are immutable for a given source).
- Multi-target translation (only Thai for now; `targetLang` param leaves the door open).
