/**
 * Capture the product screenshots the marketing pages use.
 *
 * The marketing imagery rule is "real UI only": a fifth of SaaS sites never
 * show the product, and every illustration-led page in this category looks
 * like every other one. The risk with real screenshots is that they go stale,
 * so they are captured by a script against a running, seeded app rather than
 * pasted in by hand — a drifted screenshot then shows up as a diff in
 * `public/marketing/`, not as something nobody noticed for a year.
 *
 * Usage:
 *
 *   pnpm add -D playwright && npx playwright install chromium
 *   MARKETING_SHOT_BASE=http://localhost:3000 \
 *   MARKETING_SHOT_EMAIL=demo@example.com \
 *   MARKETING_SHOT_PASSWORD=... \
 *   node scripts/marketing-screenshots.mjs
 *
 * Playwright is deliberately *not* a dependency of this package: it pulls a
 * browser down and nothing in the app or the test suite needs it. The script
 * says so and exits rather than failing with a module-resolution error.
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'public', 'marketing');

const BASE = process.env.MARKETING_SHOT_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.MARKETING_SHOT_EMAIL;
const PASSWORD = process.env.MARKETING_SHOT_PASSWORD;

/**
 * Each shot names the file the marketing page references. Widths match the
 * frames the images sit in (`components/marketing/frames.tsx`) so the captured
 * pixels are the displayed pixels and nothing is resampled.
 */
const SHOTS = [
  { name: 'prepare', path: '/documents/prepare', width: 1280, height: 960 },
  { name: 'workflow', path: '/documents/workflow', width: 1280, height: 960 },
  { name: 'audit', path: '/documents/audit', width: 1280, height: 960 },
  { name: 'payments', path: '/account/payments', width: 1280, height: 960 },
  { name: 'brand', path: '/account/brand', width: 1280, height: 960 },
  { name: 'api-keys', path: '/developer/api', width: 1280, height: 960 },
  { name: 'signing-phone', path: '/documents/signer-view', width: 390, height: 844 },
];

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error(
      'playwright is not installed.\n\n' +
        '  pnpm add -D playwright && npx playwright install chromium\n\n' +
        'It is not a dependency of this package on purpose: it downloads a\n' +
        'browser and only this script needs it.',
    );
    process.exit(1);
  }
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(
      'Set MARKETING_SHOT_EMAIL and MARKETING_SHOT_PASSWORD to an account in a\n' +
        'seeded demo workspace. Never point this at production data: whatever is\n' +
        "on screen ends up in a public image.",
    );
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();

  // Sign in once; the session cookie carries across the rest of the captures.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });

    // Freeze anything that would make two runs differ for no reason.
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`,
    });
    await page.waitForTimeout(400);

    const file = resolve(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`captured ${shot.name}.png`);
  }

  await browser.close();
  console.log(`\n${SHOTS.length} screenshots written to public/marketing/`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
