'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ActionResult, ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';

export type RowDetailVM = import('@/lib/payroll/run').PayrollRowDetail;
export type FrozenSlipVM = {
  incomeBase: string;
  incomeOther: string;
  deductSso: string;
  deductAttendance: string;
  deductLeave: string;
  deductAdvance: string;
  deductDebt: string;
  deductOther: string;
  netPay: string;
};

type Props = {
  employeeName: string;
  status: 'Draft' | 'Published' | 'Locked';
  monthLabel: string;
  month: string;
  employeeId: string;
  /** Server action to fetch detail on demand — Draft rows only. */
  loadDetail: (employeeId: string, month: string) => Promise<RowDetailVM | null>;
  /** Frozen stored buckets — Published/Locked rows only (no recompute). */
  frozen: FrozenSlipVM | null;
  canPublish: boolean;
  publishAction: (employeeId: string, month: string) => Promise<ActionResult>;
};

function Line({ label, formula, value }: { label: string; formula?: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <div className="min-w-0">
        <span className="text-ink-1">{label}</span>
        {formula && <span className="ml-2 text-[11px] text-ink-4">{formula}</span>}
      </div>
      <span className="shrink-0 font-mono text-ink-2">{value}</span>
    </div>
  );
}

export function RowDetail({
  employeeName,
  status,
  monthLabel,
  month,
  employeeId,
  loadDetail,
  frozen,
  canPublish,
  publishAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RowDetailVM | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // bump to retry (re-mounts the iframe)

  useEffect(() => {
    if (!open || status !== 'Draft' || hasLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadDetail(employeeId, month)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
          setHasLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setHasLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, status, hasLoaded, loadDetail, employeeId, month]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        ดูรายละเอียด
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`สลิปเงินเดือน — ${employeeName}`}
        className="sm:max-w-lg"
      >
        <p className="mt-1 text-xs text-ink-3">งวด {monthLabel}</p>
        {status === 'Draft' ? (
          loading ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              <span
                className="size-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-ink-1">กำลังโหลดรายละเอียด…</p>
            </div>
          ) : error ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              <p className="text-sm text-red-600">โหลดรายละเอียดไม่สำเร็จ</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setError(false);
                  setHasLoaded(false);
                }}
              >
                ลองใหม่
              </Button>
            </div>
          ) : detail ? (
            <div className="mt-4 space-y-4">
              {/* รายได้ */}
              <section>
                <h3 className="text-xs font-semibold text-ink-3">รายได้</h3>
                <Line label="ฐานเงินเดือน" value={detail.incomeBase} />
                {detail.adjustments
                  .filter((a) => a.kind === 'Income')
                  .map((a, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: adjustments have no stable id; list is immutable within this render
                    <Line key={`inc-${idx}`} label={a.reason} value={`+${a.amount}`} />
                  ))}
              </section>
              {/* รายการหัก — with formulas */}
              <section className="border-t border-gray-100 pt-3">
                <h3 className="text-xs font-semibold text-ink-3">รายการหัก</h3>
                {detail.breakdown.sso.applied !== '0.00' && (
                  <Line
                    label="ประกันสังคม"
                    formula={`${detail.breakdown.sso.cappedBase} × ${detail.breakdown.sso.rate}${detail.breakdown.sso.capped ? ` (สูงสุด ${detail.breakdown.sso.amountCap})` : ''}`}
                    value={`-${detail.breakdown.sso.applied}`}
                  />
                )}
                {detail.breakdown.attendance.absent.money !== '0.00' && (
                  <Line
                    label="ขาดงาน"
                    formula={`${detail.breakdown.attendance.absent.count} วัน × ${detail.breakdown.attendance.absent.perDay}`}
                    value={`-${detail.breakdown.attendance.absent.money}`}
                  />
                )}
                {detail.breakdown.attendance.lateTier1.money !== '0.00' && (
                  <Line
                    label="มาสาย"
                    formula={
                      detail.breakdown.attendance.lateTier1.mode === 'threeStrike'
                        ? `${detail.breakdown.attendance.lateTier1.count} ครั้ง → ${detail.breakdown.attendance.lateTier1.days} วัน × ${detail.breakdown.attendance.lateTier1.perUnit}`
                        : `${detail.breakdown.attendance.lateTier1.count} ครั้ง × ${detail.breakdown.attendance.lateTier1.perUnit}`
                    }
                    value={`-${detail.breakdown.attendance.lateTier1.money}`}
                  />
                )}
                {detail.breakdown.attendance.lateSevere.money !== '0.00' && (
                  <Line
                    label="มาสายรุนแรง"
                    formula={`${detail.breakdown.attendance.lateSevere.days} วัน × ${detail.breakdown.attendance.lateSevere.perDay}`}
                    value={`-${detail.breakdown.attendance.lateSevere.money}`}
                  />
                )}
                {detail.breakdown.attendance.earlyLeave.money !== '0.00' && (
                  <Line
                    label="ออกก่อนเวลา"
                    formula={`${detail.breakdown.attendance.earlyLeave.count} ครั้ง × ${detail.breakdown.attendance.earlyLeave.perUnit}`}
                    value={`-${detail.breakdown.attendance.earlyLeave.money}`}
                  />
                )}
                {detail.advances.map((a, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: advances have no stable id; list is immutable within a render
                  <Line key={`adv-${idx}`} label="หักเบิกล่วงหน้า" value={`-${a.amount}`} />
                ))}
                {detail.debts.map((d, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: debts have no stable id; list is immutable within a render
                  <Line key={`debt-${idx}`} label="หักหนี้/ผ่อน" value={`-${d.amount}`} />
                ))}
                {detail.leaveDeductions.map((l, idx) => (
                  <Line
                    // biome-ignore lint/suspicious/noArrayIndexKey: leave lines have no stable id; list is immutable within this render
                    key={`lv-${idx}`}
                    label="ลาเกินสิทธิ"
                    formula={`เกิน ${l.overMinutes} นาที`}
                    value={`-${l.deduct}`}
                  />
                ))}
                {detail.adjustments
                  .filter((a) => a.kind === 'Deduction')
                  .map((a, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: adjustments have no stable id; list is immutable within this render
                    <Line key={`ded-${idx}`} label={a.reason} value={`-${a.amount}`} />
                  ))}
              </section>
              {/* สุทธิ */}
              <section className="flex items-baseline justify-between border-t border-gray-200 pt-3">
                <span className="text-sm font-semibold text-ink-1">เงินสุทธิ</span>
                <span className="font-mono text-lg font-bold text-primary-700">
                  {detail.netPay}
                </span>
              </section>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-3">ไม่มีข้อมูลการคำนวณสำหรับงวดนี้</p>
          )
        ) : frozen ? (
          /* Published/Locked — frozen stored buckets, no formula, no recompute. */
          <div className="mt-4 space-y-4">
            <section>
              <h3 className="text-xs font-semibold text-ink-3">รายได้</h3>
              <Line label="ฐานเงินเดือน" value={frozen.incomeBase} />
              {frozen.incomeOther !== '0.00' && (
                <Line label="เงินเพิ่ม" value={`+${frozen.incomeOther}`} />
              )}
            </section>
            <section className="border-t border-gray-100 pt-3">
              <h3 className="text-xs font-semibold text-ink-3">รายการหัก</h3>
              {frozen.deductSso !== '0.00' && (
                <Line label="ประกันสังคม" value={`-${frozen.deductSso}`} />
              )}
              {frozen.deductAttendance !== '0.00' && (
                <Line label="หักขาด/ลา/สาย" value={`-${frozen.deductAttendance}`} />
              )}
              {frozen.deductLeave !== '0.00' && (
                <Line label="ลาเกินสิทธิ" value={`-${frozen.deductLeave}`} />
              )}
              {frozen.deductAdvance !== '0.00' && (
                <Line label="หักเบิกล่วงหน้า" value={`-${frozen.deductAdvance}`} />
              )}
              {frozen.deductDebt !== '0.00' && (
                <Line label="หักหนี้/ผ่อน" value={`-${frozen.deductDebt}`} />
              )}
              {frozen.deductOther !== '0.00' && (
                <Line label="หักอื่น ๆ" value={`-${frozen.deductOther}`} />
              )}
            </section>
            <section className="flex items-baseline justify-between border-t border-gray-200 pt-3">
              <span className="text-sm font-semibold text-ink-1">เงินสุทธิ</span>
              <span className="font-mono text-lg font-bold text-primary-700">{frozen.netPay}</span>
            </section>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-3">ไม่มีข้อมูลการคำนวณสำหรับงวดนี้</p>
        )}

        {status === 'Draft' && detail && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            {!showPreview ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowPreview(true);
                  setPreviewLoading(true);
                }}
              >
                ดูตัวอย่างสลิป (PDF)
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-ink-3">ตัวอย่างสลิป (PDF)</p>
                  {/* Honest retry: a 500/blank from the route still "loads" into the iframe,
                      so we cannot reliably auto-detect failure — give a manual reload that
                      re-mounts the iframe by bumping its key. */}
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewKey((k) => k + 1);
                      setPreviewLoading(true);
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
                  >
                    โหลดใหม่
                  </button>
                </div>
                <div className="relative">
                  {previewLoading && (
                    <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-white/80">
                      <div className="flex flex-col items-center gap-2">
                        <span
                          className="size-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
                          aria-hidden="true"
                        />
                        <p className="text-xs text-ink-3">กำลังสร้างตัวอย่างสลิป…</p>
                      </div>
                    </div>
                  )}
                  <iframe
                    key={previewKey}
                    title="ตัวอย่างสลิปเงินเดือน"
                    src={`/admin/payroll/preview-pdf?m=${month}&employeeId=${employeeId}`}
                    className="h-[60vh] w-full rounded-lg border border-gray-200"
                    onLoad={() => setPreviewLoading(false)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {canPublish && status === 'Draft' && detail && (
          <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
            <ConfirmDialog
              trigger={(openConfirm) => (
                <Button type="button" onClick={openConfirm}>
                  เผยแพร่ + ส่งสลิป
                </Button>
              )}
              title="เผยแพร่สลิปและส่ง LINE?"
              description={`เผยแพร่สลิปของ ${employeeName} งวด ${monthLabel} และส่งแจ้งเตือน LINE ถึงพนักงาน — ดำเนินการแล้วย้อนกลับไม่ได้`}
              confirmLabel="เผยแพร่ + ส่ง LINE"
              tone="primary"
              action={() => publishAction(employeeId, month)}
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
