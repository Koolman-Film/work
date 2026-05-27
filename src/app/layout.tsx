import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koolman Work',
  description: 'ระบบ HR สำหรับ Koolman',
  // Default to Thai; per-route localization will refine later via next-intl
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
