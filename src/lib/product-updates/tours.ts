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
];
