import type { Metadata } from 'next';
import './globals.css';
import { SFProvider } from '@/lib/sf/state';
import { SF_FONT } from '@/lib/sf/fallback';
import { fontVariables } from '@/lib/sf/fonts';
import { DialogProvider } from '@/components/sf/DialogProvider';

export const metadata: Metadata = {
  title: { default: 'SignerPro', template: '%s' },
  description: 'SignerPro — e-signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body style={{ fontFamily: SF_FONT, color: '#0f172a', background: '#f5f6f8' }}>
        <SFProvider><DialogProvider>{children}</DialogProvider></SFProvider>
      </body>
    </html>
  );
}
