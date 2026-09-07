/**
 * `next/font/google` is compiled away by the Next.js loader, which resolves the
 * font files and rewrites each call into a plain object. Under Vitest there is
 * no loader, so the real module's exports are not callable. Stub each loader
 * with the shape `lib/sf/fonts.ts` consumes: a class name, a CSS variable name
 * and a family. The variable is what the app actually reads, and jsdom applies
 * no fonts anyway, so the values only need to be stable, not real.
 */
type FontArgs = { variable?: string } | undefined;

const loader = (family: string) => (args?: FontArgs) => ({
  className: `__font_${family.replace(/\W+/g, '_')}`,
  variable: args?.variable ?? '',
  style: { fontFamily: family },
});

export const Geist = loader('Geist');
export const Geist_Mono = loader('Geist Mono');
export const Caveat = loader('Caveat');
export const Dancing_Script = loader('Dancing Script');
export const Great_Vibes = loader('Great Vibes');
