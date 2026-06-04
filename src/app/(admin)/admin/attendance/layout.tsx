/**
 * Attendance layout — thin pass-through. Each attendance page owns its
 * own padding + PageHeader + <AttendanceTabs> (the horizontal sub-nav),
 * matching the leave/advance pages.
 */
export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
