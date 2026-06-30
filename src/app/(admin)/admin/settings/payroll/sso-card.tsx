'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * SSO card with a live "rate × ceiling = max" line. Inputs are uncontrolled
 * form fields (they submit with the parent server-component form) but mirrored
 * into local state so we can show the computed contribution and warn when the
 * amount cap doesn't match — leaving the amount cap behind silently
 * neutralizes a salary-ceiling change (calc applies BOTH caps).
 */
export function SsoCard({
  defaultRatePercent,
  defaultSalaryCap,
  defaultAmountCap,
}: {
  defaultRatePercent: string;
  defaultSalaryCap: string;
  defaultAmountCap: string;
}) {
  const [ratePercent, setRatePercent] = useState(defaultRatePercent);
  const [salaryCap, setSalaryCap] = useState(defaultSalaryCap);
  const [amountCap, setAmountCap] = useState(defaultAmountCap);

  const r = ratePercent.trim() !== '' ? Number(ratePercent) : NaN;
  const s = salaryCap.trim() !== '' ? Number(salaryCap) : NaN;
  const a = amountCap.trim() !== '' ? Number(amountCap) : NaN;
  const product = Number.isFinite(r) && Number.isFinite(s) ? (r / 100) * s : NaN;
  const mismatch =
    Number.isFinite(product) && Number.isFinite(a) && Math.round(product) !== Math.round(a);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ประกันสังคม</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="อัตรา (%)" htmlFor="ssoRatePercent">
            <Input
              id="ssoRatePercent"
              name="ssoRatePercent"
              inputMode="decimal"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เพดานเงินเดือน (บาท)" htmlFor="ssoSalaryCap">
            <Input
              id="ssoSalaryCap"
              name="ssoSalaryCap"
              inputMode="decimal"
              value={salaryCap}
              onChange={(e) => setSalaryCap(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เพดานเงินสมทบ (บาท)" htmlFor="ssoAmountCap">
            <Input
              id="ssoAmountCap"
              name="ssoAmountCap"
              inputMode="decimal"
              value={amountCap}
              onChange={(e) => setAmountCap(e.target.value)}
              required
            />
          </FormField>
        </div>
        {Number.isFinite(product) && (
          <p className="text-sm text-ink-3">
            เงินสมทบสูงสุด = {ratePercent}% × {s.toLocaleString('en-US')} ={' '}
            <strong>฿{product.toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong>
          </p>
        )}
        {mismatch && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            เพดานเงินสมทบ (฿{a.toLocaleString('en-US')}) ไม่เท่ากับ อัตรา × เพดานเงินเดือน (฿
            {product.toLocaleString('en-US', { maximumFractionDigits: 2 })}) —
            ตรวจสอบอีกครั้งหากไม่ได้ตั้งใจ
          </p>
        )}
      </CardBody>
    </Card>
  );
}
