import 'server-only';

/**
 * พนักงานที่ยังทำงานอยู่และเช็คอินได้ แต่ไม่ได้ผูก WorkSchedule
 *
 * คนกลุ่มนี้ถูก `isScheduledWorkday` (src/lib/attendance/schedule.ts) นับเป็น
 * จ–ส โดยปริยาย จึงอาจถูกแจ้งว่า "ยังไม่เช็คอิน" ในวันที่จริง ๆ แล้วไม่ต้อง
 * ทำงาน — เคสที่ลูกค้าเจอกับพนักงานที่ทำงาน จ/พ/ศ
 *
 * นี่คือแหล่งความจริงเดียวสำหรับทุกจุดที่เตือนเรื่องนี้ (หน้ารายชื่อพนักงาน,
 * หน้าลงเวลาสด, แจ้งเตือนรายวัน, ฟอร์มเพิ่มพนักงาน) — อย่านับซ้ำที่อื่น
 * มิฉะนั้นตัวเลขจะเพี้ยนจากกันแบบเดียวกับที่เคยเกิดกับ badge/list ของรายการโต้แย้ง
 *
 * `canCheckIn: false` ไม่ถูกนับ — คนกลุ่มนั้นไม่มีทางถูกแจ้งอยู่แล้ว จึงไม่ควร
 * ทำให้แอดมินตกใจโดยไม่จำเป็น
 */

import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

export type EmployeeMissingSchedule = {
  id: string;
  /** ชื่อเล่นถ้ามี ไม่งั้นชื่อ-นามสกุล */
  name: string;
  branchName: string;
};

export async function employeesWithoutSchedule(
  permitted: PermittedBranches,
): Promise<EmployeeMissingSchedule[]> {
  const rows = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      canCheckIn: true,
      workScheduleId: null,
      ...employeeBranchScope(permitted),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
    },
  });

  return rows.map((e) => ({
    id: e.id,
    name: e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim(),
    branchName: e.branch.name,
  }));
}
