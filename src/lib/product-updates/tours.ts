// th/en are human-authored; my/lo/zh-CN/km are AI-drafted — pending
// native-speaker proofread.
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
        title: {
          th: 'หน้าหลัก',
          en: 'Home',
          my: 'ပင်မစာမျက်နှာ',
          lo: 'ໜ້າຫຼັກ',
          'zh-CN': '主页',
          km: 'ទំព័រដើម',
        },
        body: {
          th: 'ภาพรวมงานทั้งหมดเริ่มที่นี่',
          en: 'Your dashboard overview starts here.',
          my: 'အလုပ်အားလုံး၏ ခြုံငုံသုံးသပ်ချက်ကို ဤနေရာမှ စတင်ပါသည်။',
          lo: 'ພາບລວມຂອງວຽກທັງໝົດເລີ່ມຢູ່ນີ້.',
          'zh-CN': '所有工作的概览从这里开始。',
          km: 'ទិដ្ឋភាពរួមនៃការងារទាំងអស់ចាប់ផ្តើមនៅទីនេះ។',
        },
        side: 'right',
      },
      {
        anchor: 'whats-new-button',
        title: {
          th: 'มีอะไรใหม่',
          en: "What's New",
          my: 'အသစ်များ',
          lo: 'ມີຫຍັງໃໝ່',
          'zh-CN': '新功能',
          km: 'អ្វីថ្មី',
        },
        body: {
          th: 'กดที่นี่เพื่อดูฟีเจอร์ใหม่และเริ่มทัวร์อีกครั้งได้ทุกเมื่อ',
          en: 'Open this anytime to see new features and replay tours.',
          my: 'ဤနေရာကို အချိန်မရွေးဖွင့်၍ လုပ်ဆောင်ချက်အသစ်များကြည့်ကာ လမ်းညွှန်ကို ပြန်ကြည့်နိုင်ပါသည်။',
          lo: 'ເປີດບ່ອນນີ້ໄດ້ທຸກເມື່ອເພື່ອເບິ່ງຄຸນສົມບັດໃໝ່ ແລະ ເບິ່ງທົວອີກຄັ້ງ.',
          'zh-CN': '随时打开这里查看新功能并重新播放导览。',
          km: 'បើកនៅទីនេះបានគ្រប់ពេលដើម្បីមើលមុខងារថ្មី និងចាក់បង្ហាញដំណើរកម្សាន្តឡើងវិញ។',
        },
        side: 'right',
      },
      {
        anchor: 'topbar-bell',
        title: {
          th: 'การแจ้งเตือน',
          en: 'Notifications',
          my: 'အသိပေးချက်များ',
          lo: 'ການແຈ້ງເຕືອນ',
          'zh-CN': '通知',
          km: 'ការជូនដំណឹង',
        },
        body: {
          th: 'งานที่ต้องดำเนินการจะแจ้งเตือนที่นี่',
          en: 'Items needing your action show up here.',
          my: 'သင်ဆောင်ရွက်ရန်လိုအပ်သော အရာများကို ဤနေရာတွင် ဖော်ပြပါမည်။',
          lo: 'ລາຍການທີ່ຕ້ອງການການດຳເນີນການຈະສະແດງຢູ່ນີ້.',
          'zh-CN': '需要您处理的事项会显示在这里。',
          km: 'ធាតុដែលត្រូវការសកម្មភាពរបស់អ្នកនឹងបង្ហាញនៅទីនេះ។',
        },
        side: 'bottom',
      },
    ],
  },
  {
    // Every anchor here lives in the persistent admin shell (topbar/sidebar),
    // never on a page. runTour resolves anchors against whatever page the
    // reader happens to be on and silently drops the ones it cannot find, so a
    // page-anchored step in a tour launched from the What's New panel would
    // vanish for most readers. Three shell steps that always resolve beat six
    // that sometimes do.
    id: 'ui-refresh',
    steps: [
      {
        anchor: 'theme-toggle',
        title: {
          th: 'สว่าง / มืด / ตามเครื่อง',
          en: 'Light / Dark / System',
          my: 'အလင်း / အမှောင် / စက်အလိုက်',
          lo: 'ສະຫວ່າງ / ມືດ / ຕາມເຄື່ອງ',
          'zh-CN': '浅色 / 深色 / 跟随系统',
          km: 'ភ្លឺ / ងងឹត / តាមឧបករណ៍',
        },
        body: {
          th: 'เลือกโหมดได้ที่นี่ "ตามเครื่อง" จะเปลี่ยนตามการตั้งค่าของมือถือหรือคอมพิวเตอร์เอง และค่าที่เลือกจะจำไว้ทุกครั้งที่เข้าใช้',
          en: 'Pick your mode here. "System" follows your phone or computer’s own setting, and whatever you choose is remembered next time you sign in.',
          my: 'မုဒ်ကို ဤနေရာတွင် ရွေးချယ်ပါ။ "စက်အလိုက်" သည် သင့်ဖုန်း သို့မဟုတ် ကွန်ပျူတာ၏ ဆက်တင်အတိုင်း လိုက်ပြောင်းပါမည်။ ရွေးထားသည့်တန်ဖိုးကို နောက်တစ်ကြိမ် ဝင်ရောက်သည့်အခါ မှတ်ထားပါမည်။',
          lo: 'ເລືອກໂໝດໄດ້ຢູ່ນີ້. "ຕາມເຄື່ອງ" ຈະປ່ຽນຕາມການຕັ້ງຄ່າຂອງມືຖື ຫຼື ຄອມພິວເຕີເອງ ແລະ ຄ່າທີ່ເລືອກຈະຖືກຈື່ໄວ້ໃນຄັ້ງຕໍ່ໄປ.',
          'zh-CN':
            '在这里选择模式。“跟随系统”会随您手机或电脑的设置自动切换，您的选择会被记住，下次登录时依然生效。',
          km: 'ជ្រើសរើសរបៀបនៅទីនេះ។ "តាមឧបករណ៍" នឹងប្តូរតាមការកំណត់នៃទូរស័ព្ទ ឬកុំព្យូទ័ររបស់អ្នក ហើយតម្លៃដែលបានជ្រើសនឹងត្រូវចងចាំសម្រាប់លើកក្រោយ។',
        },
        side: 'bottom',
      },
      {
        anchor: 'topbar-bell',
        title: {
          th: 'ตัวเลขแจ้งเตือนอ่านชัดขึ้น',
          en: 'Notification counts are legible again',
          my: 'အသိပေးချက် ဂဏန်းများ ပိုမိုထင်ရှားလာသည်',
          lo: 'ໂຕເລກແຈ້ງເຕືອນອ່ານຊັດຂຶ້ນ',
          'zh-CN': '通知数字更清晰了',
          km: 'លេខជូនដំណឹងអានច្បាស់ជាងមុន',
        },
        body: {
          th: 'ตัวเลขบนกระดิ่งและในเมนูด้านซ้ายเคยจางจนอ่านยาก ตอนนี้ปรับให้ชัดทั้งโหมดสว่างและโหมดมืดแล้ว',
          en: 'The counts on the bell and in the left-hand nav used to wash out. They now hold their contrast in both light and dark.',
          my: 'ခေါင်းလောင်းပေါ်နှင့် ဘယ်ဘက်မီနူးရှိ ဂဏန်းများသည် ယခင်က မှိန်ဖျော့ပြီး ဖတ်ရခက်ခဲ့သည်။ ယခု အလင်းနှင့် အမှောင် နှစ်မျိုးစလုံးတွင် ထင်ရှားစွာ မြင်ရပါပြီ။',
          lo: 'ໂຕເລກເທິງກະດິ່ງ ແລະ ໃນເມນູດ້ານຊ້າຍ ເຄີຍຈາງຈົນອ່ານຍາກ. ດຽວນີ້ປັບໃຫ້ຊັດທັງໂໝດສະຫວ່າງ ແລະ ໂໝດມືດແລ້ວ.',
          'zh-CN':
            '铃铛上和左侧导航里的数字过去偏淡、难以辨认，现在在浅色和深色模式下都保持了足够的对比度。',
          km: 'លេខនៅលើកណ្តឹង និងក្នុងម៉ឺនុយខាងឆ្វេង ធ្លាប់ស្រអាប់ពិបាកអាន។ ឥឡូវនេះវារក្សាភាពផ្ទុយគ្នាបានល្អទាំងរបៀបភ្លឺ និងងងឹត។',
        },
        side: 'bottom',
      },
      {
        anchor: 'whats-new-button',
        title: {
          th: 'อยากดูซ้ำ กดที่นี่',
          en: 'Replay this anytime',
          my: 'ပြန်ကြည့်လိုပါက ဤနေရာကို နှိပ်ပါ',
          lo: 'ຢາກເບິ່ງຄືນ ກົດຢູ່ນີ້',
          'zh-CN': '想再看一遍，点这里',
          km: 'ចង់មើលម្តងទៀត ចុចទីនេះ',
        },
        body: {
          th: 'ทัวร์นี้และรายการอัปเดตทั้งหมดอยู่ในเมนู "มีอะไรใหม่" เปิดดูเมื่อไหร่ก็ได้ ไม่ต้องรอให้ระบบเด้งขึ้นมา',
          en: 'This tour and every past update live under "What’s New". Open it whenever you like — you do not have to wait for a popup.',
          my: 'ဤလမ်းညွှန်နှင့် ယခင်အပ်ဒိတ်များအားလုံးကို "အသစ်များ" တွင် ထားရှိသည်။ ပေါ်လာသည်ကို စောင့်စရာမလိုဘဲ အချိန်မရွေး ဖွင့်ကြည့်နိုင်ပါသည်။',
          lo: 'ທົວນີ້ ແລະ ລາຍການອັບເດດທັງໝົດຢູ່ໃນ "ມີຫຍັງໃໝ່". ເປີດເບິ່ງເມື່ອໃດກໍ່ໄດ້ ບໍ່ຕ້ອງລໍຖ້າໃຫ້ລະບົບເດັ້ງຂຶ້ນມາ.',
          'zh-CN': '本导览和所有历史更新都收在“新功能”里，随时可以打开，不必等系统弹窗。',
          km: 'ដំណើរកម្សាន្តនេះ និងបច្ចុប្បន្នភាពមុនៗទាំងអស់ស្ថិតនៅក្នុង "អ្វីថ្មី"។ បើកមើលបានគ្រប់ពេល ដោយមិនចាំបាច់រង់ចាំការលោតឡើងទេ។',
        },
        side: 'right',
      },
    ],
  },
];
