/**
 * Master switch for the admin-side LINE experience:
 *   - self-pairing at /admin/settings/line (admin binds their own LINE),
 *   - the employee-account merge wizard (dashboard nudge + profile card),
 *   - the admin rich menu assigned when an admin pairs.
 *
 * Disabled temporarily by request. Flip to `true` to restore all of it —
 * no other change is needed (every surface and entry action reads this flag).
 */
export const ADMIN_LINE_LINK_ENABLED = false;
