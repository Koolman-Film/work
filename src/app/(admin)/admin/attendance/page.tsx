import { redirect } from 'next/navigation';

/**
 * Index → bounce to the live board.
 * Per docs/v1/screens/admin.md the default landing for an admin's "ลงเวลา"
 * click is "what's happening right now" (the live board), with disputed
 * + manual reachable from the side-tab nav.
 */
export default function AttendanceIndexPage() {
  redirect('/admin/attendance/live');
}
