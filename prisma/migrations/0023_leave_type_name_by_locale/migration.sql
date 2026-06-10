-- Per-locale display names for leave types (worker-facing UI). The canonical
-- `name` stays Thai (admin UI is intentionally untranslated); this JSONB map
-- holds optional translations keyed by app locale, e.g.
-- {"en": "Personal leave", "my": "..."}. Readers fall back to `name` for
-- missing/blank locales, so NULL is a fully valid state.
ALTER TABLE "LeaveType" ADD COLUMN "nameByLocale" JSONB;
