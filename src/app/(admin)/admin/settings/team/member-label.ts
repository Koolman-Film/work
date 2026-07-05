/**
 * Pure display-identity resolver for the team-admin list.
 *
 * The team page lists every admin-tier User. In the unified-identity model an
 * admin is EITHER an email-invited account (`email` set, no Employee) OR an
 * employee who holds an admin/superadmin role and logs in via LINE (`email`
 * null, Employee set). The old cell printed `email ?? '—'`, so LINE-based
 * admins — including Superadmins — rendered as an unidentifiable dash.
 *
 * This resolves a human-readable identity so every admin is nameable at a
 * glance. Kept pure (no prisma, no JSX) so the branching is unit-tested; the
 * page decides how to render each `kind`.
 */

export type MemberEmployee = {
  nickname: string | null;
  firstName: string;
  lastName: string;
};

export type MemberIdentity =
  /** Email-invited admin — show the email, as before. */
  | { kind: 'email'; label: string }
  /** LINE-based employee-admin (no email) — show their name + a LINE hint. */
  | { kind: 'line'; label: string }
  /** No email and no Employee — shouldn't happen; render a dash. */
  | { kind: 'unknown' };

/**
 * Prefer email (the login the row is keyed on). Otherwise fall back to the
 * linked employee's "nickname · full name" (nickname alone if that's all we
 * have, full name alone if there's no nickname). Only degrade to `unknown`
 * when there's genuinely nothing to show.
 */
export function memberIdentity(m: {
  email: string | null;
  employee: MemberEmployee | null;
}): MemberIdentity {
  if (m.email?.trim()) return { kind: 'email', label: m.email.trim() };

  if (m.employee) {
    const nickname = m.employee.nickname?.trim() ?? '';
    const full = `${m.employee.firstName} ${m.employee.lastName}`.trim();
    const label = nickname && full ? `${nickname} · ${full}` : nickname || full;
    if (label) return { kind: 'line', label };
  }

  return { kind: 'unknown' };
}

/** Stable sort key so emailless rows order by their display label, not ''. */
export function memberSortKey(m: {
  email: string | null;
  employee: MemberEmployee | null;
}): string {
  const id = memberIdentity(m);
  return id.kind === 'unknown' ? '' : id.label;
}
