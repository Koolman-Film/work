'use client';

/**
 * Daily check-in widget — the Phase-1 LIFF home.
 *
 * State machine the button cycles through:
 *
 *   ╭────────────╮  tap  ╭──────────────╮ ok ╭────────────╮ ok ╭────────────╮
 *   │ idle       │ ───→  │ capturing-   │ →  │ locating   │ →  │ uploading  │
 *   │ "เช็คอิน"  │       │ selfie *     │    │            │    │ +submitting│
 *   ╰─────┬──────╯       ╰──────┬───────╯    ╰─────┬──────╯    ╰──────┬─────╯
 *         │                     │ cancel           │ deny/timeout    │ ok
 *         │                     ↓                  ↓                 ↓
 *         │               (back to idle)     ╭────────────╮    ╭─────────────╮
 *         │                                  │ gps-error  │    │ done        │
 *         │                                  ╰────────────╯    │ Confirmed/  │
 *         │                                                    │ Disputed    │
 *         │                                                    ╰─────────────╯
 *         │
 *         │ (initialState says hasCheckedIn=true) →
 *         │ show check-out button instead. Same flow but no GPS / selfie needed.
 *
 *   * The capturing-selfie phase is skipped entirely when selfieRequired=false.
 *     When required, the SelfieStep overlay handles capture → preview → confirm,
 *     then we proceed to GPS + upload + submit.
 *
 * Why no LIFF SDK init here:
 *   - By the time the user lands on /liff/check-in, the LIFF→Supabase
 *     handshake has already happened (in /liff/pair) and the proxy enforces
 *     a session. We just trust the cookie. If the cookie expired silently,
 *     calling the server action returns `forbidden` and we surface a
 *     "re-open in LINE" hint.
 */

import { useState } from 'react';
import { type CheckInState, submitCheckIn, submitCheckOut } from '@/lib/attendance/check-in';
import { compressToJpeg, uploadSelfie } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';
import { SelfieStep } from './selfie-step';

type Phase =
  | { kind: 'idle' }
  | { kind: 'capturing-selfie' }
  | { kind: 'uploading-selfie' }
  | { kind: 'locating' }
  | { kind: 'submitting' }
  | { kind: 'success'; outcome: 'Confirmed' | 'Disputed'; message: string }
  | { kind: 'error'; message: string };

type Branch = { id: string; name: string };

type Props = {
  employeeFirstName: string;
  employeeLastName: string;
  branches: readonly Branch[];
  /** Server-computed: ANY assigned branch has requireSelfie=true. */
  selfieRequired: boolean;
  initialState: CheckInState;
  dateLine: string;
};

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8_000,
  maximumAge: 0,
};

async function getPosition(): Promise<GeolocationPosition> {
  if (!('geolocation' in navigator)) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับ GPS');
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'กรุณาอนุญาตให้แอปเข้าถึงตำแหน่ง';
    case err.POSITION_UNAVAILABLE:
      return 'ไม่สามารถระบุตำแหน่งได้ — ลองออกที่โล่ง';
    case err.TIMEOUT:
      return 'ค้นหาตำแหน่งใช้เวลานานเกินไป — ลองอีกครั้ง';
    default:
      return 'เกิดข้อผิดพลาดในการระบุตำแหน่ง';
  }
}

export default function CheckInClient({
  employeeFirstName,
  employeeLastName,
  branches,
  selfieRequired,
  initialState,
  dateLine,
}: Props) {
  const [state, setStateLocal] = useState<CheckInState>(initialState);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  /**
   * Core check-in pipeline (after any selfie capture is complete).
   * Either `selfieFile=null` (no selfie required) or a captured File
   * (compress + upload before submitting).
   */
  async function runCheckIn(selfieFile: File | null) {
    try {
      let selfieKey: string | null = null;

      if (selfieFile) {
        setPhase({ kind: 'uploading-selfie' });
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) {
          setPhase({
            kind: 'error',
            message: 'เซสชันหมดอายุ — กรุณาเปิด LINE ใหม่อีกครั้ง',
          });
          return;
        }
        const compressed = await compressToJpeg(selfieFile);
        const uploadResult = await uploadSelfie(supabase, compressed, authData.user.id);
        selfieKey = uploadResult.key;
      }

      setPhase({ kind: 'locating' });
      const pos = await getPosition();

      setPhase({ kind: 'submitting' });
      const result = await submitCheckIn({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        selfieKey,
      });
      if (result.ok) {
        setStateLocal(result.state);
        setPhase({ kind: 'success', outcome: result.outcome, message: result.message });
      } else {
        setPhase({ kind: 'error', message: result.message });
      }
    } catch (err) {
      // Narrow the various error shapes — GeolocationPositionError from
      // the Web API, our own SelfieUploadError object shape, generic
      // Error fallback.
      let message = 'เกิดข้อผิดพลาด';
      if (err instanceof GeolocationPositionError) {
        message = geoErrorMessage(err);
      } else if (typeof err === 'object' && err !== null && 'kind' in err) {
        // Shape from upload-selfie.ts
        const e = err as { kind: string; message?: string };
        message =
          e.kind === 'decode-failed'
            ? 'อ่านไฟล์รูปไม่ได้'
            : e.kind === 'upload-failed'
              ? `อัปโหลดเซลฟี่ไม่สำเร็จ: ${e.message ?? ''}`
              : e.kind === 'too-large-after-compress'
                ? 'รูปใหญ่เกินไป กรุณาลองใหม่'
                : 'เกิดข้อผิดพลาด';
      } else if (err instanceof Error) {
        message = err.message;
      }
      setPhase({ kind: 'error', message });
    }
  }

  /**
   * Top-level check-in handler. Branches based on whether a selfie is
   * required: if so, open the capture overlay first and resume in
   * `onSelfieConfirmed`. Otherwise, go straight to GPS + submit.
   */
  function onCheckIn() {
    if (selfieRequired) {
      setPhase({ kind: 'capturing-selfie' });
    } else {
      void runCheckIn(null);
    }
  }

  function onSelfieConfirmed(file: File) {
    // Returning to idle visually + then running the pipeline. We don't
    // want the selfie overlay rendered while uploading / locating.
    void runCheckIn(file);
  }

  function onSelfieCancelled() {
    setPhase({ kind: 'idle' });
  }

  async function onCheckOut() {
    try {
      setPhase({ kind: 'submitting' });
      const result = await submitCheckOut();
      if (result.ok) {
        setStateLocal(result.state);
        setPhase({ kind: 'success', outcome: 'Confirmed', message: result.message });
      } else {
        setPhase({ kind: 'error', message: result.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setPhase({ kind: 'error', message });
    }
  }

  // Which action to surface? Three cases.
  //   - Has not checked in yet today → Check-in button.
  //   - Checked in, not yet out      → Check-out button.
  //   - Already out                  → Disabled "เสร็จสิ้นวันนี้" card.
  const mode: 'check-in' | 'check-out' | 'done' = !state.hasCheckedIn
    ? 'check-in'
    : !state.hasCheckedOut
      ? 'check-out'
      : 'done';

  const isBusy =
    phase.kind === 'capturing-selfie' ||
    phase.kind === 'uploading-selfie' ||
    phase.kind === 'locating' ||
    phase.kind === 'submitting';

  return (
    <>
      {/* Selfie capture overlay — fullscreen modal when active. The
          main content below stays mounted so phase transitions don't
          reset scroll position when the overlay closes. */}
      {phase.kind === 'capturing-selfie' && (
        <SelfieStep onConfirm={onSelfieConfirmed} onCancel={onSelfieCancelled} />
      )}

      <main className="mx-auto max-w-md px-4 pt-8 pb-12">
        {/* Greeting */}
        <div className="space-y-1">
          <p className="text-sm text-gray-500">{dateLine}</p>
          <h1 className="text-2xl font-semibold text-gray-900">
            สวัสดี, {employeeFirstName} {employeeLastName}
          </h1>
        </div>

        {/* Today's status card */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">สถานะวันนี้</h2>
          <div className="mt-3 space-y-2 text-sm">
            <StatusRow
              label="เช็คอิน"
              value={
                state.clockInAt
                  ? `${formatTimeBkk(state.clockInAt)}${state.branchName ? ` • ${state.branchName}` : ''}`
                  : 'ยังไม่ได้เช็คอิน'
              }
              tone={state.clockInAt ? 'on' : 'off'}
              badge={state.checkInStatus === 'Disputed' ? 'ตรวจสอบ' : null}
            />
            <StatusRow
              label="เช็คเอาท์"
              value={state.hasCheckedOut ? 'เช็คเอาท์แล้ว' : '—'}
              tone={state.hasCheckedOut ? 'on' : 'off'}
              badge={null}
            />
          </div>
        </section>

        {/* Primary action */}
        <section className="mt-6">
          {mode === 'check-in' && (
            <PrimaryButton
              label={isBusy ? '...' : 'เช็คอินเข้างาน'}
              onClick={onCheckIn}
              disabled={isBusy}
              tone="primary"
            />
          )}
          {mode === 'check-out' && (
            <PrimaryButton
              label={isBusy ? '...' : 'เช็คเอาท์'}
              onClick={onCheckOut}
              disabled={isBusy}
              tone="secondary"
            />
          )}
          {mode === 'done' && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-center text-sm text-green-800">
              ✓ เสร็จสิ้นวันนี้แล้ว ขอบคุณค่ะ
            </div>
          )}

          {/* Live phase feedback under the button */}
          <div className="mt-3 min-h-[1.5rem] text-center text-xs text-gray-500">
            {phase.kind === 'uploading-selfie' && 'กำลังอัปโหลดเซลฟี่...'}
            {phase.kind === 'locating' && 'กำลังหาตำแหน่ง...'}
            {phase.kind === 'submitting' && 'กำลังบันทึก...'}
            {phase.kind === 'success' && (
              <span className={phase.outcome === 'Confirmed' ? 'text-green-700' : 'text-amber-700'}>
                {phase.message}
              </span>
            )}
            {phase.kind === 'error' && <span className="text-red-700">{phase.message}</span>}
          </div>
        </section>

        {/* Quick actions — leave, advance (advance lands in W4d) */}
        <section className="mt-6 grid grid-cols-2 gap-3">
          <a
            href="/liff/leave"
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700"
          >
            📅 คำขอลา
          </a>
          <a
            href="/liff/advance"
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-sm font-medium text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700"
          >
            💰 ขอเบิกเงิน
          </a>
        </section>

        {/* Assigned branches list (helps employee orient themselves) */}
        {branches.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              สาขาที่ได้รับมอบหมาย
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {branches.map((b) => (
                <li key={b.id} className="rounded-md bg-gray-50 px-3 py-2">
                  {b.name}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function StatusRow({
  label,
  value,
  tone,
  badge,
}: {
  label: string;
  value: string;
  tone: 'on' | 'off';
  badge: string | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="flex items-center gap-2 text-right">
        <span className={tone === 'on' ? 'font-medium text-gray-900' : 'text-gray-400'}>
          {value}
        </span>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            {badge}
          </span>
        )}
      </span>
    </div>
  );
}

function PrimaryButton({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone: 'primary' | 'secondary';
}) {
  const base =
    'w-full rounded-xl px-5 py-4 text-base font-medium shadow-sm transition disabled:opacity-60';
  const cls =
    tone === 'primary'
      ? `${base} bg-primary-600 text-white hover:bg-primary-700`
      : `${base} border border-gray-300 bg-white text-gray-900 hover:bg-gray-50`;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {label}
    </button>
  );
}

/** Format an ISO timestamp as HH:mm in Asia/Bangkok. */
function formatTimeBkk(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}
