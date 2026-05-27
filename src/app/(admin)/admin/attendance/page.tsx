import { redirect } from 'next/navigation';

/**
 * Index → bounce to the live board (or disputed inbox until Live ships).
 * Per docs/v1/screens/admin.md the default landing is the live view, but
 * until W3c-2 builds it we land on the disputed inbox which IS available.
 */
export default function AttendanceIndexPage() {
  redirect('/admin/attendance/disputed');
}
