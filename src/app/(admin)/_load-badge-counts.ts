/**
 * Re-export shim — the counts moved to `src/lib/notifications/pending-counts.ts`
 * so both the sidebar badges and the admin daily-digest cron can share one
 * implementation (crons live in `lib/`, so the original app-dir location
 * wasn't importable from there). Keep this export so existing imports of
 * `loadSidebarBadgeCounts` from this path keep working.
 */
export { loadPendingCounts as loadSidebarBadgeCounts } from '@/lib/notifications/pending-counts';
