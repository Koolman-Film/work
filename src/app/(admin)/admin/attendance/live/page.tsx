/**
 * /admin/attendance/live — today's check-in board.
 *
 * Server Component does the initial fetch (so the page is useful even
 * before client JS hydrates / Realtime connects). The Client child
 * subscribes to Supabase Realtime for live updates and falls back to
 * 30-second polling if the WebSocket dies.
 */

import { getTodayAttendance } from '@/lib/attendance/live';
import { LiveBoardClient } from './live-client';

export default async function LiveBoardPage() {
  const initial = await getTodayAttendance();
  return <LiveBoardClient initialRows={initial} />;
}
