/** Pure helpers for <TranslatableText> — kept separate from the client
 *  component so they're unit-testable in the node environment. */

/** Thai display names for the languages Koolman staff actually submit in.
 *  Anything not listed falls back to its raw code (rare; still informative). */
const LANGUAGE_NAMES_TH: Record<string, string> = {
  th: 'ไทย',
  my: 'พม่า',
  lo: 'ลาว',
  km: 'เขมร',
  en: 'อังกฤษ',
  zh: 'จีน',
};

/** Base language subtag, lowercased — "zh-CN" → "zh", "TH" → "th". */
function baseTag(code: string): string {
  return code.toLowerCase().split('-')[0] ?? '';
}

/** Thai name for a BCP-47-ish language code, or the raw code if unknown. */
export function languageNameTh(code: string): string {
  if (!code) return '';
  return LANGUAGE_NAMES_TH[baseTag(code)] ?? code;
}

/** True when the detected source language is already the target (so there's
 *  nothing useful to show — the text is already Thai). Region-insensitive. */
export function isAlreadyTarget(detected: string, target: string): boolean {
  if (!detected) return false;
  return baseTag(detected) === baseTag(target);
}
