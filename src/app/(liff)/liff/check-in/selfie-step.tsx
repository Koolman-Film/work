'use client';

/**
 * Selfie capture overlay for the LIFF check-in flow.
 *
 * Modal-style fullscreen overlay (mobile-optimized) with three states:
 *
 *   1. **idle / open camera** — render the native file input prompt via
 *      `<input type=file capture=user>`. The OS opens its camera UI;
 *      this avoids re-implementing camera preview / MediaRecorder logic.
 *   2. **preview** — show the captured photo + "ถ่ายใหม่" / "ใช้ภาพนี้".
 *   3. **(internal-to-parent)** uploading + compressing happens after
 *      "ใช้ภาพนี้" is confirmed — this component just returns the File
 *      to the parent via onConfirm.
 *
 * Why we don't preview directly from the camera (getUserMedia):
 *   - LIFF in-app browsers historically have spotty MediaRecorder
 *     support; the OS-native camera dialog (capture=user) is universal.
 *   - Native UX matches what employees expect from any other phone app.
 *   - getUserMedia would require its own permission grant on top of the
 *     existing geolocation grant — two prompts is worse than one tap.
 */

import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

type Props = {
  /** Called when the user confirms a captured image. Parent handles
   *  the compress + upload pipeline. */
  onConfirm: (file: File) => void;
  /** Called when the user dismisses the modal without confirming. */
  onCancel: () => void;
};

export function SelfieStep({ onConfirm, onCancel }: Props) {
  const t = useTranslations('checkin');
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [captured, setCaptured] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCaptured(file);
    // Revoke any prior preview URL to avoid memory leaks before
    // generating the new one.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCaptured(null);
    // Re-open the camera. Clicking the hidden input programmatically
    // launches the OS picker again.
    fileInputRef.current?.click();
  }

  function confirm() {
    if (!captured) return;
    onConfirm(captured);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('selfie.dialogLabel')}
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10"
        >
          {t('selfie.cancel')}
        </button>
        <p className="text-sm font-medium">{t('selfie.title')}</p>
        <span className="w-[60px]" /> {/* spacer to balance the cancel button */}
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        {!previewUrl ? (
          <>
            <div className="flex flex-col items-center text-center text-white/80">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-16 w-16"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"
                />
              </svg>
              <p className="mt-4 text-base font-medium text-white">{t('selfie.instruction')}</p>
              <p className="mt-2 text-sm text-white/60">{t('selfie.branchRequirement')}</p>
            </div>
            <label
              htmlFor={fileInputId}
              className="mt-8 cursor-pointer rounded-full bg-white px-8 py-3 text-base font-semibold text-gray-900 shadow-lg active:scale-95"
            >
              {t('selfie.openCamera')}
            </label>
          </>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center">
            {/* biome-ignore lint/performance/noImgElement: object-URL preview can't use next/image */}
            <img
              src={previewUrl}
              alt={t('selfie.previewAlt')}
              className="max-h-[60vh] w-full rounded-2xl object-contain"
            />
            <div className="mt-6 flex w-full gap-3">
              <button
                type="button"
                onClick={retake}
                className="flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/20"
              >
                {t('selfie.retake')}
              </button>
              <button
                type="button"
                onClick={confirm}
                className="flex-1 rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-primary-700"
              >
                {t('selfie.usePhoto')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input — the native camera UI takes over when clicked.
          `capture="user"` requests the front camera; phones honor this
          unless the user manually switches in the camera UI. */}
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleFileChange}
        className="sr-only"
      />
    </div>
  );
}
