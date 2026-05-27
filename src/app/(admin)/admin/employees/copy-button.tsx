'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Tiny client-only widget — copies text to the clipboard and shows a
 * confirmation tick for 2 seconds. The fallback for older browsers
 * (where `navigator.clipboard.writeText` doesn't exist) is a silent
 * no-op; admins on modern Chrome/Safari/Firefox always get the path.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / non-secure contexts — silent fail
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      {copied ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
    </Button>
  );
}
