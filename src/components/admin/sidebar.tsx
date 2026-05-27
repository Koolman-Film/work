'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Admin sidebar nav.
 *
 * The structure follows docs/v1/screens/navigation.md §sidebar layout —
 * 240px wide on desktop, slide-in drawer on mobile (the mobile drawer is
 * deferred until we actually have an admin using a phone).
 *
 * Active-item detection: a nav item is "active" when the current pathname
 * starts with its href (so /admin/branches/new still highlights "สาขา").
 */

type NavItem = { href: string; label: string; emoji: string };

const NAV: ReadonlyArray<{ section: string; items: NavItem[] }> = [
  {
    section: 'งานประจำวัน',
    items: [
      { href: '/admin', label: 'แดชบอร์ด', emoji: '🏠' },
      // { href: '/admin/leave', label: 'คำขอลา', emoji: '🟡' },          // W4
      // { href: '/admin/advance', label: 'คำขอเบิก', emoji: '💵' },      // W4
      // { href: '/admin/attendance', label: 'การเข้างาน', emoji: '⏰' }, // W3
    ],
  },
  {
    section: 'พนักงาน',
    items: [
      { href: '/admin/employees', label: 'พนักงาน', emoji: '👥' }, // W2b
      { href: '/admin/branches', label: 'สาขา', emoji: '🏢' },
      { href: '/admin/departments', label: 'แผนก', emoji: '🗂️' },
      { href: '/admin/accounting-groups', label: 'กลุ่มบัญชี', emoji: '📊' },
    ],
  },
  // {
  //   section: 'ตั้งค่า',
  //   items: [
  //     { href: '/admin/leave-types', label: 'ประเภทการลา', emoji: '📝' },
  //     { href: '/admin/work-schedules', label: 'ตารางงาน', emoji: '🕓' },
  //     { href: '/admin/holidays', label: 'วันหยุด', emoji: '🎉' },
  //   ],
  // },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white lg:block">
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className="border-b border-gray-100 px-5 py-5">
          <Link href="/admin" className="block text-lg font-semibold text-primary-700">
            Koolman HR
          </Link>
          <p className="mt-0.5 text-xs text-gray-500">แผงควบคุมผู้ดูแล</p>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.section}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                        isActive(item.href)
                          ? 'bg-primary-50 font-medium text-primary-700'
                          : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <span aria-hidden="true">{item.emoji}</span>
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <form action="/logout" method="post" className="border-t border-gray-100 px-3 py-3">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <span aria-hidden="true">🚪</span>
            <span>ออกจากระบบ</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
