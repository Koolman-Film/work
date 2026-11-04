import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/**
 * Add `ids` to a user's seen-set in ONE statement: the union happens inside
 * Postgres, so two saves landing together (the first-run marker and a page's
 * batch, or two tabs) both survive. Reading the column in the app and writing
 * the merged array back — the previous version — let the later write erase
 * the earlier one; losing `first-run.welcome` that way restarts the welcome
 * tour on a later login.
 *
 * A column that is null or not a JSON array counts as empty, matching
 * `parseSeen`. Ids are stored sorted and de-duplicated.
 */
export async function addSeenIds(
  userId: string,
  ids: readonly string[],
  db: Pick<PrismaClient, '$executeRaw'> = prisma,
): Promise<void> {
  if (ids.length === 0) return;
  await db.$executeRaw`
    UPDATE "User"
    SET "productUpdatesSeen" = (
      SELECT to_jsonb(array_agg(DISTINCT x ORDER BY x))
      FROM (
        SELECT jsonb_array_elements_text(
          CASE WHEN jsonb_typeof("productUpdatesSeen") = 'array'
               THEN "productUpdatesSeen" ELSE '[]'::jsonb END
        )
        UNION
        SELECT unnest(${[...ids]}::text[])
      ) AS t(x)
    )
    WHERE id = ${userId}::uuid`;
}
