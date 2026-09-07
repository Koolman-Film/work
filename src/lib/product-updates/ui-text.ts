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
  /** No trailing arrow: the control is a bordered button with a leading icon
   *  now, and a typographic arrow inside it reads as a second, competing
   *  affordance. Baking punctuation into six translations also made the arrow
   *  a translator's problem rather than the layout's. */
  takeTheTour: {
    th: 'ดูทัวร์แนะนำ',
    en: 'Take the tour',
    my: 'လမ်းညွှန်ကြည့်ရန်',
    lo: 'ເບິ່ງທົວແນະນຳ',
    'zh-CN': '开始导览',
    km: 'មើលដំណើរកម្សាន្ត',
  },
  tourNext: {
    th: 'ถัดไป',
    en: 'Next',
    my: 'နောက်တစ်ခု',
    lo: 'ຕໍ່ໄປ',
    'zh-CN': '下一步',
    km: 'បន្ទាប់',
  },
  tourPrev: {
    th: 'ก่อนหน้า',
    en: 'Previous',
    my: 'ယခင်',
    lo: 'ກ່ອນໜ້າ',
    'zh-CN': '上一步',
    km: 'ថយក្រោយ',
  },
  tourDone: {
    th: 'เสร็จสิ้น',
    en: 'Done',
    my: 'ပြီးပါပြီ',
    lo: 'ສຳເລັດ',
    'zh-CN': '完成',
    km: 'រួចរាល់',
  },
  /** driver.js template. `{{current}}` and `{{total}}` are substituted by the
   *  library — a locale that drops either placeholder renders a broken
   *  counter, which `ui-text.test.ts` fails the build over. */
  tourProgress: {
    th: '{{current}} จาก {{total}}',
    en: '{{current}} of {{total}}',
    my: '{{total}} ခုအနက် {{current}}',
    lo: '{{current}} ຈາກ {{total}}',
    'zh-CN': '第 {{current}} 步，共 {{total}} 步',
    km: '{{current}} ក្នុងចំណោម {{total}}',
  },
} satisfies Record<string, LocalizedText>;
