import type { Metadata } from 'next';
import './globals.css';
import { SFProvider } from '@/lib/sf/state';

export const metadata: Metadata = {
  title: 'SignForge',
  description: 'SignForge — e-signature platform'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SFProvider>{children}</SFProvider>
      </body>
    </html>
  );
}
