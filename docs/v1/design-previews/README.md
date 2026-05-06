# Design Direction Previews

Self-contained HTML files — เปิดใน browser เพื่อดู mockup จริงเปรียบเทียบกัน

**✅ Decision locked: Theme 1 — Finnix Blue Tech**
- Now drilling into [font comparison](./fonts-compare-blue-tech.html) + [style tweaks](./style-tweaks-blue-tech.html)

## วิธีดู

```bash
# จาก project root:
open docs/v1/design-previews/index.html

# หรือ start static server เพื่อดูดี:
cd docs/v1/design-previews
python3 -m http.server 8080
# → http://localhost:8080
```

แต่ละไฟล์ standalone — ดับเบิ้ลคลิกเปิด browser ตรงๆ ได้

## Theme 1 deep-dive (current focus)

| File | What |
|---|---|
| **[fonts-compare-blue-tech.html](./fonts-compare-blue-tech.html)** ⭐ | 5 Thai fonts compared in Theme 1 colors — IBM Plex / Sarabun / Prompt / Anuphan / Noto Sans Thai — login + dashboard mini mockup per font + summary star ratings |
| **[style-tweaks-blue-tech.html](./style-tweaks-blue-tech.html)** ⭐ | 4 style variants in Theme 1 — A. Comfortable / B. Dense Pro / C. Soft Modern / D. Flat Minimal — full login + dashboard + admin table per variant |

## Color direction archive (decision archived — Theme 1 picked)

| File | Theme | Color | Font | Vibe |
|---|---|---|---|---|
| [index.html](./index.html) | Overview + links | — | — | — |
| **[01-finnix-blue-tech.html](./01-finnix-blue-tech.html)** ⭐ | **Finnix Blue Tech** (PICKED) | Blue + Amber | IBM Plex Sans Thai | Modern automotive-tech |
| [05-finnix-red.html](./05-finnix-red.html) | Finnix Red (refined) | Scarlet + Onyx | Anuphan | Premium automotive (too red for ongoing use) |
| [02-corporate-navy.html](./02-corporate-navy.html) | Corporate Navy | Navy + Warm Orange | Sarabun | Thai corporate, trustworthy |
| [03-modern-slate.html](./03-modern-slate.html) | Modern Slate | Slate + Emerald | Prompt | Linear/Notion premium SaaS |
| [04-industrial-steel.html](./04-industrial-steel.html) | Industrial Steel | Steel + Cyan | Noto Sans Thai | Automotive precision, blueprint |

## What's in each preview

ทุกไฟล์มีสิ่งเหล่านี้ในรูปแบบของ theme นั้น:

1. **Color palette swatches** — primary scale + accent + status colors พร้อม hex
2. **Typography samples** — H1, H2, body, tabular numerals (ภาษาไทย+ตัวเลข)
3. **Login screen mockup** — full screen
4. **Employee Dashboard mockup** — KPI card + mini stats + pending request + quick actions
5. **Admin payroll table** — 3 rows of payroll data with status badges
6. **Component samples** — buttons, status badges
7. **"When to choose" section** — เหตุผลที่ควรเลือก theme นี้
8. **Light + Dark mode** — toggle ที่ด้านบน

## How to compare

แนะนำ:
1. เปิด 4 tabs ใน browser → 1 theme ต่อ tab
2. Cmd+Tab สลับ tab ดูเปรียบเทียบ
3. หรือเปิด 2 หน้าจอ side-by-side
4. Toggle dark mode ใน theme ที่สนใจ

## Decision matrix

| Criteria | T5: Finnix Red ⭐ | T1: Blue Tech | T2: Corporate Navy | T3: Modern Slate | T4: Industrial Steel |
|---|---|---|---|---|---|
| **First impression** | Bold, premium, brand | Modern, clean | Trustworthy, traditional | Premium, minimal | Technical, bold |
| **Thai font readability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Aligns with Koolman brand** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Mid-aged user friendly** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Young user friendly** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Professional/enterprise feel** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Differentiation** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Risk of looking dated in 3 yr** | low | low | medium | low | low-med |
| **Dark mode quality** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Marketing alignment** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ | ⭐⭐⭐⭐ |
| **Risk of red-fatigue** | medium | none | none | none | none |

## My recommendation per scenario

> ทั้งนี้ต้องดูคนตัดสินใจ + อายุเฉลี่ยพนักงาน + Finnix brand identity

**Default (brand-aligned):**
→ **Theme 5: Finnix Red** ⭐ — ตอนนี้รู้แล้วว่า brand เป็นแดง → เลือกเป็น default ทำให้ HR app ตรงกับ identity ของ Koolman จริง

**ถ้า Owner Finnix ค่อนไป mid-aged + ทีม sales/install เป็นหลัก:**
→ **Theme 2: Corporate Navy** — safe, ลดความเสี่ยงคนรู้สึก "อ่านยาก" หรือ "ดูแปลก"

**ถ้า Finnix อยาก position ตัวเองเป็น "tech-forward car shop" + ไม่ติดสีแดงตามแบรนด์:**
→ **Theme 4: Industrial Steel** — เด่น, จดจำ, สะท้อน automotive identity

**ถ้าอยาก "premium tool" ดู modern แบบ Linear:**
→ **Theme 3: Modern Slate** — แต่อาจดูเย็นไปสำหรับ HR

**ถ้าต้องการ balance ปลอดภัย — modern + tech-leaning:**
→ **Theme 1: Finnix Blue Tech**

## Mix-and-match options

ถ้าไม่มี theme ไหนตรงใจ 100% — บอกได้ว่าจะ mix ส่วนไหนจาก theme ไหน:

| Component | จาก theme |
|---|---|
| Color palette | Theme 1 / 2 / 3 / 4 / custom hex |
| Font | IBM Plex / Sarabun / Prompt / Noto Sans Thai / อื่นๆ |
| Border style | rounded (theme 1, 3) / sharp (theme 4) |
| Vibe | tech / corporate / minimal / industrial |
| Number font | match body (theme 1, 2) / monospace (theme 3, 4) |
| Status badge | filled (theme 1, 2) / outline (theme 3) / monospace box (theme 4) |

## Next step

หลังเลือก:
1. บอก **theme number** หรือ **mix** ที่ต้องการ
2. ผมจะเขียน `docs/v1/design-system.md` (full spec) ตามที่เลือก
3. รวมถึง Tailwind 4 `@theme` config ที่ใช้ได้จริงใน code
4. Build `/styleguide` page ใน W1 ของ build-plan

## Notes

- ทุก theme รองรับ light + dark mode
- ทุก theme ใช้ Google Fonts (free, web-safe)
- ทุก theme มี responsive layout (เปิดบน mobile ได้)
- Color palette ทุก theme ผ่าน WCAG AA contrast (4.5:1+)
- Status badges ใช้ semantic colors เหมือนกัน 6 ตัว — เปลี่ยนแค่ visual treatment
