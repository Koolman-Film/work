// th/en are human-authored; my/lo/zh-CN/km are AI-drafted — pending
// native-speaker proofread.
import type { UpdateItem } from './types';

/**
 * The What's New content. Newest items can go anywhere — ordering is by
 * `date`, computed at render. Add a new entry per release; give it a fresh,
 * stable `id`. Set `announce: true` to pop a modal on next load.
 *
 * `announce` answers one question only: is this release worth interrupting
 * for? It does NOT pick which entry the modal shows — the modal shows every
 * unseen entry, so any number of them can carry the flag and they all arrive
 * together in one scrollable batch.
 *
 * Bodies accept the small markup in `rich-text.ts`: `- ` starts a bullet,
 * `**bold**`, `_italic_`, `==highlight==`. Lead with one sentence of prose,
 * then bullet the rules — eight admins skim, they do not read a paragraph.
 * Highlight at most ONE thing per entry, or it stops meaning anything.
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
  {
    // Shipped 2 Sep as an inert switch; the date below is the ship date, but
    // the date that matters to a reader is the cutoff in the body — nothing is
    // charged until 27 Sep.
    id: 'auto-absence-2026-09',
    date: '2026-09-02',
    title: {
      th: 'เริ่มนับวันขาดงานอัตโนมัติ ตั้งแต่ 27 ก.ย. 2569',
      en: 'Automatic absence counting starts 27 September 2026',
      my: 'စက်တင်ဘာ ၂၇ ရက်မှစ၍ ပျက်ကွက်ရက်များကို အလိုအလျောက် ရေတွက်ပါမည်',
      lo: 'ເລີ່ມນັບມື້ຂາດວຽກອັດຕະໂນມັດ ຕັ້ງແຕ່ວັນທີ 27 ກັນຍາ 2026',
      'zh-CN': '自 2026 年 9 月 27 日起自动计算缺勤日',
      km: 'ចាប់ផ្តើមរាប់ថ្ងៃអវត្តមានដោយស្វ័យប្រវត្តិ ចាប់ពីថ្ងៃទី 27 កញ្ញា 2026',
    },
    body: {
      th: 'เดิมระบบหักเงิน_เฉพาะ_วันขาดงานที่แอดมินคีย์เอง ตั้งแต่ ==27 ก.ย. 2569== เป็นต้นไป ระบบจะนับและหักเงินให้อัตโนมัติ\n- **นับเมื่อ** พนักงานมีตารางงาน แต่ไม่ได้เช็คอิน และไม่มีใบลาที่อนุมัติแล้ว\n- **ไม่คิดย้อนหลัง** วันก่อน 27 ก.ย. 2569 ไม่ถูกนำมาคิด\n- **ไม่นับซ้ำ** วันที่แอดมินคีย์ขาดงานไว้แล้ว ระบบจะไม่นับเพิ่ม\n- **รอบตุลาคม** เป็นรอบแรกที่คิดเต็มเดือน',
      en: 'Until now payroll deducted _only_ the absences an admin keyed in by hand. From ==27 September 2026==, the system counts and deducts them for you.\n- **Counted when** an employee was scheduled, did not check in, and has no approved leave\n- **Never retroactive** — dates before 27 September 2026 are not touched\n- **No double-counting** — days an admin already keyed are left alone\n- **October** is the first full month under the new rule',
      my: 'ယခင်က စာရင်းကိုင်မှ လက်ဖြင့်ထည့်သွင်းသည့် ပျက်ကွက်ရက်များကို_သာ_ နုတ်ခဲ့ပါသည်။ ==၂၀၂၆ စက်တင်ဘာ ၂၇== ရက်မှစ၍ စနစ်မှ အလိုအလျောက် ရေတွက်၍ နုတ်ပါမည်။\n- **ရေတွက်သည့်အခါ** အလုပ်ဇယားရှိပြီး ဝင်ရောက်စာရင်းသွင်းခြင်းမပြုဘဲ အတည်ပြုထားသောခွင့်လည်း မရှိသည့်ရက်\n- **နောက်ပြန်မတွက်ပါ** — ၂၀၂၆ စက်တင်ဘာ ၂၇ ရက် မတိုင်မီရက်များကို မထိပါ\n- **ထပ်၍မရေတွက်ပါ** — စာရင်းကိုင်ထည့်သွင်းပြီးသားရက်များကို ချန်ထားပါသည်\n- **အောက်တိုဘာလ** သည် စည်းမျဉ်းအသစ်ဖြင့် တစ်လလုံးတွက်သည့် ပထမဆုံးလ',
      lo: 'ແຕ່ກ່ອນລະບົບຫັກເງິນ_ສະເພາະ_ມື້ຂາດວຽກທີ່ແອດມິນປ້ອນເອງ. ຕັ້ງແຕ່ ==27 ກັນຍາ 2026== ເປັນຕົ້ນໄປ ລະບົບຈະນັບ ແລະ ຫັກເງິນໃຫ້ອັດຕະໂນມັດ.\n- **ນັບເມື່ອ** ພະນັກງານມີຕາຕະລາງວຽກ ແຕ່ບໍ່ໄດ້ເຊັກອິນ ແລະ ບໍ່ມີໃບລາທີ່ອະນຸມັດແລ້ວ\n- **ບໍ່ຄິດຍ້ອນຫຼັງ** ມື້ກ່ອນ 27 ກັນຍາ 2026 ຈະບໍ່ຖືກນຳມາຄິດ\n- **ບໍ່ນັບຊ້ຳ** ມື້ທີ່ແອດມິນປ້ອນໄວ້ແລ້ວ ລະບົບຈະບໍ່ນັບເພີ່ມ\n- **ເດືອນຕຸລາ** ເປັນເດືອນທຳອິດທີ່ຄິດເຕັມເດືອນ',
      'zh-CN':
        '此前系统_只_扣除管理员手动录入的缺勤日。自 ==2026 年 9 月 27 日== 起，系统将自动计算并扣款。\n- **计入条件**：员工有排班却未打卡，且没有已批准的请假\n- **不追溯**：2026 年 9 月 27 日之前的日期不受影响\n- **不重复计算**：管理员已手动录入的日子保持原样\n- **10 月**是按新规则完整计算的第一个月',
      km: 'ពីមុនប្រព័ន្ធកាត់ប្រាក់_តែ_ថ្ងៃអវត្តមានដែលអ្នកគ្រប់គ្រងបញ្ចូលដោយដៃ។ ចាប់ពី ==ថ្ងៃទី 27 កញ្ញា 2026== តទៅ ប្រព័ន្ធនឹងរាប់ និងកាត់ប្រាក់ដោយស្វ័យប្រវត្តិ។\n- **រាប់នៅពេល** បុគ្គលិកមានតារាងការងារ តែមិនបានចូលកត់ត្រា និងគ្មានច្បាប់ឈប់សម្រាកដែលបានអនុម័ត\n- **មិនគិតថយក្រោយ** — ថ្ងៃមុន 27 កញ្ញា 2026 មិនត្រូវបានប៉ះពាល់\n- **មិនរាប់ស្ទួន** — ថ្ងៃដែលអ្នកគ្រប់គ្រងបានបញ្ចូលរួច ត្រូវទុកដដែល\n- **ខែតុលា** ជាខែដំបូងដែលគិតពេញមួយខែ',
    },
    announce: true,
  },
  {
    id: 'ui-refresh-2026-09',
    date: '2026-09-06',
    title: {
      th: 'โฉมใหม่: โหมดมืด และตัวหนังสืออ่านง่ายขึ้น',
      en: 'A new look: dark mode and clearer text',
      my: 'အသွင်သစ် — အမှောင်မုဒ်နှင့် ဖတ်ရလွယ်သော စာလုံးများ',
      lo: 'ໂສມໜ້າໃໝ່: ໂໝດມືດ ແລະ ໂຕໜັງສືອ່ານງ່າຍຂຶ້ນ',
      'zh-CN': '全新外观：深色模式与更清晰的文字',
      km: 'រូបរាងថ្មី៖ របៀបងងឹត និងអក្សរអានច្បាស់ជាងមុន',
    },
    body: {
      th: 'ปรับหน้าตาทั้งระบบให้อ่านง่ายขึ้น และเพิ่มโหมดมืด\n- **โหมดมืด** ปุ่มสลับ สว่าง / มืด / ตามเครื่อง อยู่ ==มุมขวาบน== ของทุกหน้า\n- **อ่านชัดขึ้น** ปรับสีตัวอักษรทั้งระบบ รวมถึงตัวเลขแจ้งเตือน ให้ชัดทั้งสองโหมด\n- **กดง่ายบนมือถือ** ลิงก์ในตารางเปลี่ยนเป็นปุ่มที่มีขอบเขตชัดเจน',
      en: 'The whole app was reworked for readability, and dark mode has arrived.\n- **Dark mode** — a Light / Dark / System switch at the ==top right== of every page\n- **Clearer text** — colours across the app, notification counts included, now hold up in both modes\n- **Easier to tap** — table row actions are real buttons with a visible edge, not bare links',
      my: 'အက်ပ်တစ်ခုလုံးကို ဖတ်ရလွယ်အောင် ပြင်ဆင်ထားပြီး အမှောင်မုဒ် ထည့်သွင်းထားပါသည်။\n- **အမှောင်မုဒ်** — အလင်း / အမှောင် / စက်အလိုက် ခလုတ်သည် စာမျက်နှာတိုင်း၏ ==ညာဘက်အပေါ်ထောင့်== တွင်\n- **ပိုမိုထင်ရှား** — အသိပေးချက်ဂဏန်းများအပါအဝင် စာလုံးအရောင်များကို မုဒ်နှစ်ခုစလုံးအတွက် ပြင်ဆင်ထားသည်\n- **နှိပ်ရလွယ်** — ဇယားအတွင်းလင့်ခ်များသည် အနားသတ်ထင်ရှားသော ခလုတ်များ ဖြစ်လာသည်',
      lo: 'ປັບໜ້າຕາທົ່ວລະບົບໃຫ້ອ່ານງ່າຍຂຶ້ນ ແລະ ເພີ່ມໂໝດມືດ.\n- **ໂໝດມືດ** ປຸ່ມສະຫຼັບ ສະຫວ່າງ / ມືດ / ຕາມເຄື່ອງ ຢູ່ ==ມຸມຂວາເທິງ== ຂອງທຸກໜ້າ\n- **ອ່ານຊັດຂຶ້ນ** ປັບສີໂຕໜັງສືທົ່ວລະບົບ ລວມທັງໂຕເລກແຈ້ງເຕືອນ ໃຫ້ຊັດທັງສອງໂໝດ\n- **ກົດງ່າຍເທິງມືຖື** ລິງກ໌ໃນຕາຕະລາງປ່ຽນເປັນປຸ່ມທີ່ມີຂອບເຂດຊັດເຈນ',
      'zh-CN':
        '全站外观已针对可读性重新调整，并新增深色模式。\n- **深色模式**：浅色 / 深色 / 跟随系统 切换按钮位于每个页面的 ==右上角==\n- **文字更清晰**：全站文字颜色（含通知数字）在两种模式下均已达标\n- **更易点击**：表格内的操作链接已改为边界清晰的按钮',
      km: 'រូបរាងទូទាំងកម្មវិធីត្រូវបានកែសម្រួលឱ្យអានងាយ ហើយបានបន្ថែមរបៀបងងឹត។\n- **របៀបងងឹត** — ប៊ូតុងប្តូរ ភ្លឺ / ងងឹត / តាមឧបករណ៍ នៅ ==ជ្រុងខាងស្តាំខាងលើ== នៃគ្រប់ទំព័រ\n- **អក្សរច្បាស់ជាងមុន** — ពណ៌អក្សរទូទាំងប្រព័ន្ធ រួមទាំងលេខជូនដំណឹង ល្អក្នុងរបៀបទាំងពីរ\n- **ងាយចុច** — តំណក្នុងតារាងបានប្តូរជាប៊ូតុងដែលមានគែមច្បាស់',
    },
    announce: true,
    tour: 'ui-refresh',
  },
];
