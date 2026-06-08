/**
 * Message catalog loader with the fallback chain: target ← English ← Thai.
 *
 * Thai is the source of truth (always complete), so it is the base layer;
 * English overlays it; the target locale overlays both. A key missing in
 * the target therefore resolves to English, then Thai, before next-intl
 * would ever fall back to the raw key. Catalogs are tiny (text only), so
 * we static-import all six and merge synchronously — this keeps the
 * notification renderer (Inngest, no request) synchronous.
 */

import en from '../../../messages/en.json';
import km from '../../../messages/km.json';
import lo from '../../../messages/lo.json';
import my from '../../../messages/my.json';
import th from '../../../messages/th.json';
import zhCN from '../../../messages/zh-CN.json';
import type { Locale } from './config';

type Messages = Record<string, unknown>;

const CATALOGS: Record<Locale, Messages> = {
  th: th as Messages,
  en: en as Messages,
  my: my as Messages,
  lo: lo as Messages,
  'zh-CN': zhCN as Messages,
  km: km as Messages,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge plain objects left→right (right wins). Pure; no mutation. */
export function deepMerge(...layers: Messages[]): Messages {
  const out: Messages = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      const prev = out[k];
      out[k] = isPlainObject(prev) && isPlainObject(v) ? deepMerge(prev, v) : v;
    }
  }
  return out;
}

/** Merged catalog for `locale`: th (base) ← en ← target.
 *
 * For the `en` locale, en overlays th so English strings take priority.
 * For all other non-th locales, th overlays en (th is the authoritative
 * fallback) and the target overlays both — so untranslated keys show
 * Thai rather than English, which is the correct UX for this app.
 */
export function getMessages(locale: Locale): Messages {
  if (locale === 'th') return CATALOGS.th;
  if (locale === 'en') return deepMerge(CATALOGS.th, CATALOGS.en);
  return deepMerge(CATALOGS.en, CATALOGS.th, CATALOGS[locale]);
}
