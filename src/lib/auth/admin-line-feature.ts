/**
 * Master switch for the admin-side LINE experience:
 *   - self-pairing at /admin/settings/line (admin binds their own LINE),
 *   - the employee-account merge wizard (dashboard nudge + profile card),
 *   - the capability rich menu assigned when an admin pairs / merges.
 *
 * Re-enabled 2026-07-02 after the merge flow was hardened (atomic token
 * consume, confirm screen, non-destructive relocation, archived-employee /
 * archived-role guards) and the all-dynamic capability rich menus shipped.
 * Flip to `false` to disable all of it — every surface + entry action reads
 * this flag.
 */
export const ADMIN_LINE_LINK_ENABLED = true;
