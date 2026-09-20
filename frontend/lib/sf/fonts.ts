import { Geist, Geist_Mono, Caveat, Dancing_Script, Great_Vibes } from 'next/font/google';

/**
 * Fonts are self-hosted through `next/font` rather than pulled from
 * fonts.googleapis.com: the CSP in next.config.ts allows only
 * `style-src 'self'` and `font-src 'self' data:`, so an external stylesheet
 * (and the .woff2 files behind it) is blocked outright and every face silently
 * falls back to the generic `cursive`/`sans-serif`. next/font emits the CSS and
 * the font files from our own origin, which satisfies the CSP unchanged.
 */
export const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
export const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
export const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', display: 'swap' });
export const dancingScript = Dancing_Script({ subsets: ['latin'], variable: '--font-dancing-script', display: 'swap' });
export const greatVibes = Great_Vibes({ subsets: ['latin'], weight: '400', variable: '--font-great-vibes', display: 'swap' });


/** Class list for <html>, which publishes every face as a CSS variable. */
export const fontVariables = [
  geistSans.variable, geistMono.variable,
  caveat.variable, dancingScript.variable, greatVibes.variable,
].join(' ');

/**
 * next/font generates hashed family names, so the stored `type_face` value
 * ('Caveat', 'Dancing Script', …) can't be dropped into `fontFamily` directly.
 * Map it to the variable the loader defined instead.
 */
const TYPE_FACE_VARS: Record<string, string> = {
  'Caveat': '--font-caveat',
  'Dancing Script': '--font-dancing-script',
  'Great Vibes': '--font-great-vibes',
  'Geist': '--font-geist',
};

/** `fontFamily` value for a signature type face, with a sane fallback. */
export function typeFaceStack(face?: string | null): string {
  const v = TYPE_FACE_VARS[face || ''] || TYPE_FACE_VARS['Caveat'];
  return `var(${v}), cursive`;
}
