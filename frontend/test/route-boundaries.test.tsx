/**
 * Route-boundary coverage.
 *
 * Every route that fetches must say something while it waits and something
 * useful when it fails. Before this wave only the four `/documents/[id]/*`
 * segments and `/sign/[token]` had that; `/overview`, `/reports`, `/account/billing`,
 * `/contacts`, `/support`, `/developer/*` and all seven `/platform/*` routes
 * fell through to a generic four-tile skeleton, and `/platform/*` had no
 * `error.tsx` at all — so a failure there hit the `(app)` boundary, whose
 * recovery link points at a tenant route.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import SegmentError from '@/app/_fallbacks/SegmentError';
import ScreenSkeleton from '@/app/_fallbacks/ScreenSkeleton';
import PlatformError from '@/app/(app)/platform/error';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const app = (rel: string) => resolve(__dirname, '..', 'app', rel);

const SEGMENTS = [
  '(app)/overview',
  '(app)/reports',
  '(app)/account/billing',
  '(app)/contacts',
  '(app)/support',
  '(app)/developer/api',
  '(app)/developer/guides',
  '(app)/developer/logs',
  '(app)/developer/sandbox',
  '(app)/platform',
  '(app)/platform/tenants',
  '(app)/platform/revenue',
  '(app)/platform/invoices',
  '(app)/platform/logs',
  '(app)/platform/support',
  '(app)/platform/developer',
  '(app)/documents/[id]/prepare',
  '(app)/documents/[id]/workflow',
  '(app)/documents/[id]/signer-view',
  '(app)/documents/[id]/audit',
];

describe('every data-backed segment has a loading boundary', () => {
  it.each(SEGMENTS)('%s/loading.tsx', segment => {
    expect(existsSync(app(`${segment}/loading.tsx`))).toBe(true);
  });
});

describe('error boundaries', () => {
  it('the platform subtree owns its own', () => {
    expect(existsSync(app('(app)/platform/error.tsx'))).toBe(true);
  });

  it('the app, the platform subtree and the signing surface all have one', () => {
    for (const path of ['(app)/error.tsx', '(app)/platform/error.tsx', 'sign/[token]/error.tsx', 'error.tsx']) {
      expect(existsSync(app(path)), `missing app/${path}`).toBe(true);
    }
  });

  it('the platform boundary offers a retry and a platform route, not a tenant one', () => {
    const reset = vi.fn();
    render(<PlatformError error={new Error('boom')} reset={reset} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    const home = screen.getByRole('link', { name: /platform overview/i });
    expect(home).toHaveAttribute('href', '/platform');
    // The tenant boundary's "Open documents" would strand a super admin.
    expect(screen.queryByRole('link', { name: /open documents/i })).toBeNull();
  });

  it('retry actually calls reset', async () => {
    const reset = vi.fn();
    render(<PlatformError error={new Error('boom')} reset={reset} />);
    screen.getByRole('button', { name: /retry/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('shows the digest so a user can quote it to support', () => {
    render(
      <SegmentError
        error={Object.assign(new Error('boom'), { digest: 'd1g3st' })}
        reset={() => {}}
        title="Failed" body="Body" homeHref="/overview" homeLabel="Overview"
      />,
    );
    expect(screen.getByText(/d1g3st/)).toBeInTheDocument();
  });

  it('never leaks the raw error message to the user', () => {
    render(
      <SegmentError
        error={new Error('ECONNREFUSED 10.0.0.4:8000')}
        reset={() => {}}
        title="Failed" body="Body" homeHref="/overview" homeLabel="Overview"
      />,
    );
    expect(document.body.textContent).not.toContain('ECONNREFUSED');
  });
});

describe('loading skeletons announce themselves', () => {
  it('is a live region with an accessible name', () => {
    render(<ScreenSkeleton label="Loading contacts" shape="table" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading contacts');
  });
});
