import type { UpdateItem } from './types';

/**
 * The What's New content. Newest items can go anywhere — ordering is by
 * `date`, computed at render. Add a new entry per release; give it a fresh,
 * stable `id`. Set `announce: true` to pop a modal on next load.
 */
export const UPDATES: UpdateItem[] = [
  {
    id: 'welcome-2026-06',
    date: '2026-06-26',
    title: { th: 'ยินดีต้อนรับสู่ Koolman Work', en: 'Welcome to Koolman Work' },
    body: {
      th: 'ระบบจัดการงานบุคคลของคุณ ดูทัวร์แนะนำเพื่อเริ่มต้นใช้งานได้เลย',
      en: 'Your HR workspace. Take the quick tour to get started.',
    },
    announce: true,
    tour: 'welcome',
  },
];
