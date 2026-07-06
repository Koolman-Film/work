import type { LocalizedText } from './types';

/**
 * Localized chrome labels for the product-updates surfaces (modal + panel).
 * `th`/`en` are human-authored; `my`/`lo`/`zh-CN`/`km` are AI-drafted —
 * pending native-speaker proofread.
 */
export const UI = {
  seeAllUpdates: {
    th: 'ดูทั้งหมด',
    en: 'See all updates',
    my: 'အားလုံးကြည့်ရန်',
    lo: 'ເບິ່ງທັງໝົດ',
    'zh-CN': '查看全部',
    km: 'មើលទាំងអស់',
  },
  takeTheTour: {
    th: 'ดูทัวร์แนะนำ',
    en: 'Take the tour',
    my: 'လမ်းညွှန်ကြည့်ရန်',
    lo: 'ເບິ່ງທົວແນະນຳ',
    'zh-CN': '开始导览',
    km: 'មើលដំណើរកម្សាន្ត',
  },
  gotIt: {
    th: 'เข้าใจแล้ว',
    en: 'Got it',
    my: 'နားလည်ပါပြီ',
    lo: 'ເຂົ້າໃຈແລ້ວ',
    'zh-CN': '知道了',
    km: 'យល់ហើយ',
  },
  whatsNewTitle: {
    th: 'มีอะไรใหม่',
    en: "What's New",
    my: 'အသစ်များ',
    lo: 'ມີຫຍັງໃໝ່',
    'zh-CN': '新功能',
    km: 'អ្វីថ្មី',
  },
  takeTheTourArrow: {
    th: 'ดูทัวร์แนะนำ →',
    en: 'Take the tour →',
    my: 'လမ်းညွှန်ကြည့်ရန် →',
    lo: 'ເບິ່ງທົວແນະນຳ →',
    'zh-CN': '开始导览 →',
    km: 'មើលដំណើរកម្សាន្ត →',
  },
} satisfies Record<string, LocalizedText>;
