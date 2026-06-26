'use server';

/**
 * translateText — on-demand, cached machine translation for any free-text
 * field in the app (leave reasons, void reasons, review notes, …).
 *
 * Flow: authn → cache lookup → (miss) Google → persist → return. The cache is
 * the generic `Translation` table keyed by (sha256(sourceText), targetLang),
 * so a reason that's been translated once is free and instant forever after.
 *
 * Auth: authentication-only (`requireRole` with the full role union). This is
 * deliberately NOT gated to `leave.read` — the action is reusable across the
 * app, so a leave-specific permission would be wrong. The gate exists purely
 * to stop anonymous abuse of the paid Google API; any signed-in user who can
 * already see the underlying text may translate it.
 */

import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { translateOnce } from './google';
import { normalizeSource, sourceHashFor } from './hash';

export type TranslateTextResult = {
  translatedText: string;
  detectedSourceLang: string;
  /** true when served from the DB cache (no API call billed). */
  cached: boolean;
};

const EMPTY: TranslateTextResult = { translatedText: '', detectedSourceLang: '', cached: false };

export async function translateText(text: string, targetLang = 'th'): Promise<TranslateTextResult> {
  // Short-circuit before auth/DB/API — nothing to translate.
  if (normalizeSource(text).length === 0) return EMPTY;

  await requireRole(['Staff', 'Admin', 'Superadmin']);

  const sourceHash = sourceHashFor(text);
  const where = { sourceHash_targetLang: { sourceHash, targetLang } };

  const cached = await prisma.translation.findUnique({ where });
  if (cached) {
    return {
      translatedText: cached.translatedText,
      detectedSourceLang: cached.detectedSourceLang,
      cached: true,
    };
  }

  const { translatedText, detectedSourceLang } = await translateOnce(text, targetLang);

  try {
    await prisma.translation.create({
      data: { sourceHash, targetLang, sourceText: text, translatedText, detectedSourceLang },
    });
  } catch (err) {
    // Unique-constraint race: a concurrent first-translate of the same text
    // won the insert. Re-read and serve the winner's row instead of failing.
    if ((err as { code?: string }).code === 'P2002') {
      const raced = await prisma.translation.findUnique({ where });
      if (raced) {
        return {
          translatedText: raced.translatedText,
          detectedSourceLang: raced.detectedSourceLang,
          cached: true,
        };
      }
    }
    throw err;
  }

  return { translatedText, detectedSourceLang, cached: false };
}
