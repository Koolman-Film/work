-- Seed nameByLocale translations for the four leave types that exist in
-- production (ลากิจ, ลาคลอด, ลาป่วย, ลาพักร้อน). Matched by canonical Thai
-- name and guarded with "nameByLocale IS NULL" so the seed never clobbers
-- names an admin has already edited, and re-running is a no-op.
--
-- th is intentionally absent from the maps — readers fall back to `name`.
-- my/lo/zh-CN/km are AI drafts pending native review (same status as the
-- message catalogs for those locales).

UPDATE "LeaveType" SET "nameByLocale" = jsonb_build_object(
  'en',    'Personal leave',
  'my',    'ကိုယ်ရေးကိစ္စခွင့်',
  'lo',    'ລາກິດທຸລະ',
  'zh-CN', '事假',
  'km',    'ច្បាប់ធុរៈផ្ទាល់ខ្លួន'
) WHERE name = 'ลากิจ' AND "nameByLocale" IS NULL;

UPDATE "LeaveType" SET "nameByLocale" = jsonb_build_object(
  'en',    'Maternity leave',
  'my',    'မီးဖွားခွင့်',
  'lo',    'ລາພັກເກີດລູກ',
  'zh-CN', '产假',
  'km',    'ច្បាប់ឈប់សម្រាកមាតុភាព'
) WHERE name = 'ลาคลอด' AND "nameByLocale" IS NULL;

UPDATE "LeaveType" SET "nameByLocale" = jsonb_build_object(
  'en',    'Sick leave',
  'my',    'ဖျားနာခွင့်',
  'lo',    'ລາປ່ວຍ',
  'zh-CN', '病假',
  'km',    'ច្បាប់ឈប់សម្រាកឈឺ'
) WHERE name = 'ลาป่วย' AND "nameByLocale" IS NULL;

UPDATE "LeaveType" SET "nameByLocale" = jsonb_build_object(
  'en',    'Annual leave',
  'my',    'နှစ်ပတ်လည်ခွင့်',
  'lo',    'ລາພັກປະຈຳປີ',
  'zh-CN', '年假',
  'km',    'ច្បាប់ឈប់សម្រាកប្រចាំឆ្នាំ'
) WHERE name = 'ลาพักร้อน' AND "nameByLocale" IS NULL;
