// th/en are human-authored; my/lo/zh-CN/km are AI-drafted — pending
// native-speaker proofread.
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
    title: {
      th: 'ยินดีต้อนรับสู่ Koolman Work',
      en: 'Welcome to Koolman Work',
      my: 'Koolman Work မှ ကြိုဆိုပါသည်',
      lo: 'ຍິນດີຕ້ອນຮັບສູ່ Koolman Work',
      'zh-CN': '欢迎使用 Koolman Work',
      km: 'សូមស្វាគមន៍មកកាន់ Koolman Work',
    },
    body: {
      th: 'ระบบจัดการงานบุคคลของคุณ ดูทัวร์แนะนำเพื่อเริ่มต้นใช้งานได้เลย',
      en: 'Your HR workspace. Take the quick tour to get started.',
      my: 'သင်၏ HR လုပ်ငန်းခွင်။ စတင်အသုံးပြုရန် အမြန်လမ်းညွှန်ကို ကြည့်ရှုပါ။',
      lo: 'ບ່ອນເຮັດວຽກ HR ຂອງທ່ານ. ເບິ່ງທົວແນະນຳໄວໆເພື່ອເລີ່ມຕົ້ນ.',
      'zh-CN': '您的人力资源工作区。观看快速导览即可开始使用。',
      km: 'កន្លែងធ្វើការ HR របស់អ្នក។ មើលដំណើរកម្សាន្តរហ័សដើម្បីចាប់ផ្តើម។',
    },
    announce: true,
    tour: 'welcome',
  },
];
