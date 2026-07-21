/**
 * Detects an error thrown by Next's `notFound()` (the mechanism
 * `requirePermission`/`requireGlobalPermission` use to reject an
 * unauthorized caller) after it has crossed the Server Action RPC
 * boundary into a client component's `.catch()`.
 *
 * Distinguishing this from any other thrown error matters because it is
 * NOT retryable — mapping it to the same "system busy, try again" message
 * used for transient failures (e.g. a Prisma P2028 transaction-timeout
 * from a concurrent settle) would tell the admin to do something that can
 * never succeed.
 *
 * No public helper for this exists on the installed Next version
 * (16.2.6): the one Next ships, `isHTTPAccessFallbackError`, lives under
 * an internal dist path
 * (`next/dist/client/components/http-access-fallback/http-access-fallback`)
 * that `next/navigation` does not re-export, so importing it would pin
 * this code to an unversioned internal file layout. `notFound()` sets
 * `error.digest` to the literal string `NEXT_HTTP_ERROR_FALLBACK;404`
 * (see that same internal file) — this checks that digest directly, and
 * narrowly, so a `forbidden()`/`unauthorized()` denial elsewhere in the
 * app is not misreported as a `notFound()` permission denial.
 */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    (error as { digest: unknown }).digest === 'NEXT_HTTP_ERROR_FALLBACK;404'
  );
}
