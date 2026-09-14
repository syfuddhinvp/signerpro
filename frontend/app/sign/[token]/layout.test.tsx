/**
 * The public signing chrome carries the *sender's* brand (ORG-7).
 *
 * The rule being pinned here is a security one as much as a visual one: the
 * header must look the same for a tenant with no theme, an invalid token and a
 * branding call that failed. If a branded header only ever appeared for a real
 * token, the chrome would confirm to anyone guessing URLs that they had found
 * one.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SignerBranding } from './types';

const apiFetchPublic = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiFetchPublic: (...args: unknown[]) => apiFetchPublic(...args),
}));

import SignLayout from './layout';

const branding = (over: Partial<SignerBranding> = {}): SignerBranding => ({
  organization_name: 'Acme Realty', theme_name: 'House brand',
  logo_url: null, logo_position: 'left',
  primary_color: '#0777CF', primary_text_color: '#FFFFFF',
  ...over,
});

const unbranded = (): SignerBranding => ({
  organization_name: null, theme_name: null, logo_url: null,
  logo_position: 'left', primary_color: null, primary_text_color: null,
});

async function mount(token = 'tok-123') {
  cleanup();
  const element = await SignLayout({
    children: <div>document</div>,
    params: Promise.resolve({ token }),
  });
  return render(element);
}

beforeEach(() => {
  apiFetchPublic.mockReset();
});

describe('the signing chrome', () => {
  it('shows the sender, not SignerPro, when the tenant has a brand', async () => {
    apiFetchPublic.mockResolvedValue({ ok: true, status: 200, data: branding() });
    await mount();

    expect(screen.getByText('Acme Realty')).toBeTruthy();
    // Its own initials stand in for a tenant with a brand but no hosted logo.
    expect(screen.getByText('AR')).toBeTruthy();
    expect(screen.queryByText('SF')).toBeNull();
  });

  it('renders the tenant logo in place of any mark when one is set', async () => {
    apiFetchPublic.mockResolvedValue({
      ok: true, status: 200,
      data: branding({ logo_url: 'https://cdn.example.com/acme.png' }),
    });
    const { container } = await mount();

    const logo = container.querySelector('img');
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/acme.png');
    expect(screen.queryByText('AR')).toBeNull();
  });

  it('still names SignerPro as the sealer of the document', async () => {
    apiFetchPublic.mockResolvedValue({ ok: true, status: 200, data: branding() });
    await mount();
    // The tamper-evidence guarantee is ours; a recipient checking whether a
    // link is trustworthy has to be able to see who is actually making it.
    expect(screen.getByText(/Sent via SignerPro/)).toBeTruthy();
    expect(screen.getByText(/SHA-256 sealed/)).toBeTruthy();
  });

  it('falls back to SignerPro’s own mark for an unbranded tenant', async () => {
    apiFetchPublic.mockResolvedValue({ ok: true, status: 200, data: unbranded() });
    await mount();

    expect(screen.getByText('SignerPro')).toBeTruthy();
    expect(screen.getByText('SF')).toBeTruthy();
    expect(screen.queryByText(/Sent via SignerPro/)).toBeNull();
  });

  it('renders identically when the branding call fails', async () => {
    apiFetchPublic.mockResolvedValue({
      ok: false, error: { kind: 'network', status: 0, message: 'Failed to fetch' },
    });
    await mount();

    // No error banner on a recipient's chrome: branding is decoration, and a
    // signer cannot act on our outage.
    expect(screen.getByText('SignerPro')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for the branding of the token in the URL, encoded', async () => {
    apiFetchPublic.mockResolvedValue({ ok: true, status: 200, data: unbranded() });
    await mount('tok/../evil');

    expect(apiFetchPublic).toHaveBeenCalledWith('/api/sign/tok%2F..%2Fevil/branding');
  });

  it('renders the envelope itself whatever the branding says', async () => {
    apiFetchPublic.mockResolvedValue({ ok: true, status: 200, data: branding() });
    await mount();
    expect(screen.getByText('document')).toBeTruthy();
  });
});
