import type { Metadata } from 'next';
import './globals.css';
import { SFProvider } from '@/lib/sf/state';
import { SF_FONT } from '@/lib/sf/fallback';
import { fontVariables } from '@/lib/sf/fonts';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { ThemeProvider, ThemeScript } from '@/lib/theme/ThemeProvider';

export const metadata: Metadata = {
  title: { default: 'SignerPro', template: '%s' },
  description: 'SignerPro — e-signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Paints the stored theme before first paint; see lib/theme/themes.ts. */}
        <ThemeScript />
      </head>
      <body style={{ fontFamily: SF_FONT, color: 'hsl(var(--color-fg-default))', background: 'hsl(var(--color-bg-canvas))' }}>
        <ThemeProvider><SFProvider><DialogProvider>{children}</DialogProvider></SFProvider></ThemeProvider>
      </body>
    </html>
  );
}
