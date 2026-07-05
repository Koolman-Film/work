import type { Tour } from './types';

/**
 * Guide tours. Each step anchors to a real element via data-tour="<anchor>".
 * Anchors used here must exist in the rendered admin shell (see sidebar.tsx /
 * topbar.tsx). A missing anchor at runtime skips that step gracefully.
 */
export const TOURS: Tour[] = [
  {
    id: 'welcome',
    steps: [
      {
        anchor: 'sidebar-home',
        title: { th: 'หน้าหลัก', en: 'Home' },
        body: { th: 'ภาพรวมงานทั้งหมดเริ่มที่นี่', en: 'Your dashboard overview starts here.' },
        side: 'right',
      },
      {
        anchor: 'whats-new-button',
        title: { th: 'มีอะไรใหม่', en: "What's New" },
        body: {
          th: 'กดที่นี่เพื่อดูฟีเจอร์ใหม่และเริ่มทัวร์อีกครั้งได้ทุกเมื่อ',
          en: 'Open this anytime to see new features and replay tours.',
        },
        side: 'right',
      },
      {
        anchor: 'topbar-bell',
        title: { th: 'การแจ้งเตือน', en: 'Notifications' },
        body: { th: 'งานที่ต้องดำเนินการจะแจ้งเตือนที่นี่', en: 'Items needing your action show up here.' },
        side: 'bottom',
      },
    ],
  },
];
