# Rich-menu button art — image-generation prompts

One prompt per button. Each produces the **icon illustration** that drops into the
icon zone of a tile (the large Thai headline + multilingual subtitle are baked into
the menu layout, NOT into the generated art — so generate **no text**).

## Shared style block (prepend to every prompt)

> 3D rendered icon illustration, soft rounded clay/plasticine style, smooth matte
> surfaces, gentle studio lighting with soft shadows, friendly and modern,
> centered single object-cluster, high detail, product-icon aesthetic, 1:1 square,
> **no text, no letters, no numbers, no watermark, no people**, clean minimal
> composition, generous empty margin around the subject.

**Negative prompt:** text, words, letters, numbers, watermark, signature, busy
background, harsh shadows, photorealistic clutter, logos.

**Output:** square (1:1), transparent background **or** the tile's pastel background
(listed per button), high resolution (≥1024², upscale for the 2500-px menu).

---

## 1. Check-in — เข้างาน  (brand blue #2D6CDF on #E8F1FC)

> [style block] A modern smartphone standing upright, screen showing a simplified
> city **map with a curved route line and a blue teardrop location pin**; floating
> beside the phone, a large glossy **blue circular badge with a white checkmark**.
> Soft light-blue pastel background. Conveys "clock in at your location."

## 2. Leave — ขอลา  (warm orange #E08A2B on #FBF1E8)

> [style block] A **clipboard holding a leave-request form** (a sheet with a few
> blank lines and a small checked box — no readable text), a little **desk calendar**
> with one date marked, and a soft rounded **alarm clock** resting beside them. Warm
> peach/orange pastel background. Conveys "request time off."

## 3. Advance — ขอเบิก  (green #2EA86A on #E9F6EE)

> [style block] An **open green wallet** with a couple of banknotes peeking out, a
> shiny **gold coin**, a small rounded **calculator**, and a folded **request slip**
> with a green check. Soft mint-green pastel background. Conveys "request a cash
> advance."

## 4. Calendar — ปฏิทิน  (purple #7C5BD6 on #F1ECFB)

> [style block] A friendly **desk calendar** with a clearly highlighted date square,
> a small **green leaf** accent, and a rounded **notification bell with a red dot**
> floating at the corner. Soft lavender pastel background. Conveys "team calendar
> and schedule."

## 5. Approvals — อนุมัติ  (green #2EA86A on #E9F6EE)

> [style block] A small stack of **rounded documents**, with a glossy **green
> "approved" check-stamp** pressing down on the top sheet and a floating **green
> circular checkmark badge**. Soft mint-green pastel background. Conveys "approve
> employee requests."

## 6. Dashboard — ภาพรวม  (blue #2D6CDF on #E8F1FC)

> [style block] A floating rounded **dashboard panel** showing a small **bar chart**
> and a rising **line graph**, with a separate little **donut/pie chart** and an
> **upward arrow** beside it. Soft light-blue pastel background. Conveys "overview
> and analytics."

## 7. Reports — รายงาน  (purple #7C5BD6 on #F1ECFB)

> [style block] A printed **report document** with a tidy **bar chart and pie chart**
> printed on it (abstract bars/wedges, no readable text), a couple of sheets stacked
> behind, and a small **magnifier** resting on top. Soft lavender pastel background.
> Conveys "reports and records."

---

## Placement notes

- **Wide check-in banner** (2500×843): the check-in art sits on the **right third**;
  the headline + subtitle occupy the left two-thirds. Generate it a touch wider /
  landscape-friendly, or keep the square and place it right-aligned.
- **Square tiles** (≈833×843 each): art sits in the **top ~40%**, headline + subtitle
  below. Keep the subject compact with margin so it reads at small size in the LINE
  chat bar.
- Keep each illustration's dominant color = that tile's brand color so the art and
  the panel feel unified.
- Export each as a transparent PNG, then composite over the tile's pastel panel in
  the final menu image (the `.svg` masters in this folder are the layout templates;
  replace the flat placeholder icon group with the generated art).
