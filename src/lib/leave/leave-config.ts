import { prisma } from '@/lib/db/prisma';
import type { LeaveUnitConfig } from './units';

/** Hardcoded fallback matching the LeaveConfig column defaults — used only if
 *  the singleton row is somehow missing (fresh DB before seed). */
const FALLBACK: LeaveUnitConfig = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

/** Read the company-wide leave-unit config (singleton row). */
export async function getLeaveConfig(): Promise<LeaveUnitConfig> {
  const row = await prisma.leaveConfig.findFirst({
    select: { morningStart: true, morningEnd: true, afternoonStart: true, afternoonEnd: true },
  });
  return row ?? FALLBACK;
}
