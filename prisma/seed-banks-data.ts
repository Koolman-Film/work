/**
 * National bank reference list (BOT-supervised banks), used to seed the
 * `Bank` table. Sourced from the Bank of Thailand FI list; `code` is the
 * national clearing code, `sortOrder` puts common payroll banks first.
 *
 * Imported by both prisma/seed.ts (full seed, incl. prod) and the
 * standalone prisma/seed-banks.ts runner (`pnpm db:seed:banks`).
 * Idempotent: upsert by unique `code`, so re-running is safe.
 */

import type { PrismaClient } from '@prisma/client';

export type BankSeed = {
  code: string;
  shortName?: string;
  nameEn: string;
  nameTh: string;
};

/** Order in the array == display order (sortOrder is the 1-based index). */
export const BANKS: BankSeed[] = [
  { code: '004', shortName: 'KBANK', nameEn: 'Kasikornbank', nameTh: 'ธนาคารกสิกรไทย' },
  { code: '014', shortName: 'SCB', nameEn: 'Siam Commercial Bank', nameTh: 'ธนาคารไทยพาณิชย์' },
  { code: '002', shortName: 'BBL', nameEn: 'Bangkok Bank', nameTh: 'ธนาคารกรุงเทพ' },
  { code: '006', shortName: 'KTB', nameEn: 'Krung Thai Bank', nameTh: 'ธนาคารกรุงไทย' },
  {
    code: '025',
    shortName: 'BAY',
    nameEn: 'Bank of Ayudhya (Krungsri)',
    nameTh: 'ธนาคารกรุงศรีอยุธยา',
  },
  { code: '011', shortName: 'TTB', nameEn: 'TMBThanachart Bank', nameTh: 'ธนาคารทหารไทยธนชาต' },
  { code: '030', shortName: 'GSB', nameEn: 'Government Savings Bank', nameTh: 'ธนาคารออมสิน' },
  {
    code: '033',
    shortName: 'GHB',
    nameEn: 'Government Housing Bank',
    nameTh: 'ธนาคารอาคารสงเคราะห์',
  },
  {
    code: '034',
    shortName: 'BAAC',
    nameEn: 'Bank for Agriculture and Agricultural Cooperatives',
    nameTh: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',
  },
  { code: '069', shortName: 'KKP', nameEn: 'Kiatnakin Phatra Bank', nameTh: 'ธนาคารเกียรตินาคินภัทร' },
  { code: '067', shortName: 'TISCO', nameEn: 'Tisco Bank', nameTh: 'ธนาคารทิสโก้' },
  { code: '073', shortName: 'LHB', nameEn: 'Land and Houses Bank', nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์' },
  { code: '022', shortName: 'CIMBT', nameEn: 'CIMB Thai Bank', nameTh: 'ธนาคารซีไอเอ็มบี ไทย' },
  { code: '024', shortName: 'UOBT', nameEn: 'United Overseas Bank (Thai)', nameTh: 'ธนาคารยูโอบี' },
  {
    code: '020',
    shortName: 'SCBT',
    nameEn: 'Standard Chartered Bank (Thai)',
    nameTh: 'ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย)',
  },
  { code: '070', shortName: 'ICBC', nameEn: 'ICBC (Thai)', nameTh: 'ธนาคารไอซีบีซี (ไทย)' },
  {
    code: '071',
    shortName: 'TCRB',
    nameEn: 'Thai Credit Retail Bank',
    nameTh: 'ธนาคารไทยเครดิต เพื่อรายย่อย',
  },
  {
    code: '066',
    shortName: 'ISBT',
    nameEn: 'Islamic Bank of Thailand',
    nameTh: 'ธนาคารอิสลามแห่งประเทศไทย',
  },
  { code: '017', shortName: 'CITI', nameEn: 'Citibank N.A.', nameTh: 'ซิตี้แบงก์' },
  { code: '031', shortName: 'HSBC', nameEn: 'HSBC', nameTh: 'ธนาคารเอชเอสบีซี' },
];

/** Upsert every bank by `code`. Returns the number of banks processed. */
export async function seedBanks(prisma: PrismaClient): Promise<number> {
  for (const [i, b] of BANKS.entries()) {
    const sortOrder = i + 1;
    await prisma.bank.upsert({
      where: { code: b.code },
      update: { nameTh: b.nameTh, nameEn: b.nameEn, shortName: b.shortName ?? null, sortOrder },
      create: {
        code: b.code,
        nameTh: b.nameTh,
        nameEn: b.nameEn,
        shortName: b.shortName ?? null,
        sortOrder,
      },
    });
  }
  return BANKS.length;
}
