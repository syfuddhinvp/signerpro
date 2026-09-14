/**
 * Branding themes (ORG-7).
 *
 * Two things here are easy to get wrong and expensive when wrong, so both are
 * pinned: clearing a field must reach the API as an explicit `null` (a `''`
 * would be stored and then printed into a real recipient's email), and a
 * sender who cannot administer the tenant must be told so up front rather than
 * filling the form in and meeting a 403.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import type { BrandingThemeResponse } from '@/lib/api/types';
import Brand from './Brand';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

let role = 'admin';
vi.mock('@/components/sf/SessionProvider', () => ({
  useSession: () => ({
    userId: 'u-1', name: 'Ada', email: 'ada@acme.com', role,
    organizationId: 'org-1', organizationName: 'Acme', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const theme = (over: Partial<BrandingThemeResponse> = {}): BrandingThemeResponse => ({
  id: 'th-1', organization_id: 'org-1', name: 'House brand', is_default: true,
  logo_url: 'https://cdn.example.com/acme.png', logo_uploaded: false, logo_position: 'left',
  primary_color: '#0777CF', primary_text_color: '#FFFFFF',
  headline: 'Acme needs your signature', message: 'Acme sends every agreement through SignerPro.',
  contact_sender_email: 'processing@acme.com', footer_signature: 'Acme Realty',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', document_count: 3,
  ...over,
});

function mount(
  themes: BrandingThemeResponse[],
  loadError: string | null = null,
  extra: Partial<React.ComponentProps<typeof Brand>> = {},
) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Brand themes={themes} loadError={loadError} {...extra} />
    </DialogProvider></SFProvider>,
  );
}

const patchCalls = () => apiCall.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'PATCH');

beforeEach(() => {
  role = 'admin';
  apiCall.mockReset();
  apiCall.mockImplementation(async () => ({ ok: true, status: 200, data: theme() }));
});

describe('the branding theme editor', () => {
  it('shows what recipients see, not the workspace accent', () => {
    mount([theme()]);
    expect(screen.getByDisplayValue('Acme needs your signature')).toBeTruthy();
    expect(screen.getByDisplayValue('#0777CF')).toBeTruthy();
    // The preview renders the theme's own headline rather than the stock one.
    expect(screen.getByText('Acme needs your signature')).toBeTruthy();
    expect(screen.queryByText('You were invited to review and sign a document')).toBeNull();
  });

  it('falls back to the stock wording in the preview when no headline is set', () => {
    mount([theme({ headline: null })]);
    expect(screen.getByText('You were invited to review and sign a document')).toBeTruthy();
  });

  it('sends a cleared field as null, never as an empty string', async () => {
    mount([theme()]);
    const headline = screen.getByDisplayValue('Acme needs your signature') as HTMLInputElement;
    fireEvent.change(headline, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patchCalls().length).toBe(1));
    const body = (patchCalls()[0][1] as { body: Record<string, unknown> }).body;
    expect(body.headline).toBeNull();
    // Untouched fields still round-trip their value.
    expect(body.primary_color).toBe('#0777CF');
  });

  it('refuses to save a colour that is not a hex value', async () => {
    mount([theme()]);
    fireEvent.change(screen.getByDisplayValue('#0777CF'), { target: { value: 'blue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(patchCalls().length).toBe(0);
  });

  it('does not offer a save until something actually changed', () => {
    mount([theme()]);
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('says a non-admin cannot change branding instead of failing on submit', () => {
    role = 'sender';
    mount([theme()]);
    expect(screen.getByText('Only an organization administrator can change branding.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete theme' })).toBeNull();
  });

  it('names the envelopes a delete would release before asking', async () => {
    mount([theme({ is_default: false, document_count: 3 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete theme' }));
    expect(await screen.findByText(/3 envelopes use this theme/)).toBeTruthy();
  });

  it('reports an outage rather than showing an empty list as "no themes"', () => {
    mount([], 'Failed to fetch');
    expect(screen.getByRole('alert').textContent).toContain('Can’t reach the SignerPro API');
  });

  it('promoting a theme leaves exactly one default in the list', async () => {
    const other = theme({ id: 'th-2', name: 'Partner brand', is_default: false, document_count: 0 });
    apiCall.mockImplementation(async () => ({ ok: true, status: 200, data: { ...other, is_default: true } }));
    mount([theme(), other]);

    fireEvent.click(screen.getByText('Partner brand'));
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));

    await waitFor(() => expect(screen.getAllByText('Default').length).toBe(1));
  });
});


/**
 * Both of these shipped broken once.
 *
 * `custom_branding` is a paid entitlement that only the *writes* enforce, so
 * listing themes succeeds on every plan. The screen therefore looked completely
 * available on a plan that does not include it, and answered the first "New
 * theme" with a 402 whose message was set into state and rendered nowhere —
 * the alert lived inside the editor card, which does not exist when there are
 * no themes to edit. The net effect was a button that did nothing, silently.
 */
describe('a plan without custom branding', () => {
  it('says so before anything is clicked', () => {
    mount([], null, { entitled: false, planName: 'Team' });

    expect(screen.getByRole('status').textContent).toContain('not included in the Team plan');
    expect(screen.queryByRole('button', { name: /New theme/ })).toBeNull();
  });

  it('names the plan as the reason the list is empty', () => {
    mount([], null, { entitled: false, planName: 'Team' });
    expect(screen.getByText(/needs a plan that includes custom branding/)).toBeTruthy();
    // Not the "add one" invitation, which is an instruction they cannot follow.
    expect(screen.queryByText(/until you add one/)).toBeNull();
  });

  it('still lets them read an existing theme, without offering a save', () => {
    mount([theme()], null, { entitled: false, planName: 'Team' });

    expect(screen.getByDisplayValue('Acme needs your signature')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.getByText(/Upgrade to a plan with custom branding/)).toBeTruthy();
  });

  it('points at the plans page rather than dead-ending', () => {
    const { container } = mount([], null, { entitled: false, planName: 'Team' });
    const link = container.querySelector('a[href="/account/billing"]');
    expect(link?.textContent).toBe('View plans');
  });

  it('assumes the feature is available when the plan could not be read', () => {
    // The API stays the authority: a tenant who has paid must not be locked
    // out of their own branding by a failed subscription call.
    mount([], null, { entitled: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /New theme/ })).toBeTruthy();
  });
});

describe('a write that the API refuses', () => {
  it('shows the reason even when there is no theme selected', async () => {
    apiCall.mockResolvedValue({
      ok: false,
      status: 402,
      error: {
        kind: 'client', status: 402,
        message: "The 'custom_branding' feature is not included in the Team plan.",
      },
    });
    mount([]);

    fireEvent.click(screen.getByRole('button', { name: /New theme/ }));
    const name = await screen.findByLabelText('Theme name');
    fireEvent.change(name, { target: { value: 'House brand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create theme' }));

    // With no themes there is no editor card, which is exactly where this
    // message used to be rendered — and so never seen.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not included in the Team plan');
  });
});


/**
 * The logo is uploaded, not linked.
 *
 * Asking for a hosted image URL assumed every tenant had somewhere to host one
 * and knew what a CDN was. It is a file picker now, and the bytes go to
 * `PUT /api/branding-themes/{id}/logo`.
 */
describe('the theme logo', () => {
  const fileOf = (type: string, bytes = 10) =>
    new File([new Uint8Array(bytes)], 'logo.png', { type });

  const logoInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement;

  it('offers an upload rather than a URL field', () => {
    const { container } = mount([theme({ logo_url: null })]);

    expect(screen.queryByPlaceholderText('https://cdn.example.com/logo.png')).toBeNull();
    expect(screen.getByRole('button', { name: /Upload logo/ })).toBeTruthy();
    expect(logoInput(container).accept).toBe('image/png,image/jpeg,image/gif');
  });

  it('sends the picked file as a data URL', async () => {
    const uploaded = theme({ logo_url: 'http://localhost:3000/brand/th-1/logo?v=2', logo_uploaded: true });
    apiCall.mockResolvedValue({ ok: true, status: 200, data: uploaded });
    const { container } = mount([theme({ logo_url: null })]);

    fireEvent.change(logoInput(container), { target: { files: [fileOf('image/png')] } });

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    const [path, init] = apiCall.mock.calls[0];
    expect(path).toBe('/api/branding-themes/th-1/logo');
    expect((init as { method: string }).method).toBe('PUT');
    const body = (init as { body: { image_base64: string } }).body;
    expect(body.image_base64.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('refuses a file that is not an image it can serve, without a round trip', async () => {
    const { container } = mount([theme({ logo_url: null })]);

    fireEvent.change(logoInput(container), { target: { files: [fileOf('image/svg+xml')] } });

    expect((await screen.findByRole('alert')).textContent).toContain('PNG, JPEG or GIF');
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('refuses a file over the size the API accepts', async () => {
    const { container } = mount([theme({ logo_url: null })]);

    fireEvent.change(logoInput(container), {
      target: { files: [fileOf('image/png', 1024 * 1024 + 1)] },
    });

    expect((await screen.findByRole('alert')).textContent).toContain('1 MB or smaller');
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('offers Remove only for a logo that was uploaded here', () => {
    mount([theme({ logo_uploaded: true })]);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    // An externally hosted one is not ours to delete.
    cleanup();
    mount([theme({ logo_url: 'https://cdn.example.com/acme.png', logo_uploaded: false })]);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('shows the uploaded logo in the invitation preview', () => {
    const { container } = mount([
      theme({ logo_url: 'http://localhost:3000/brand/th-1/logo?v=2', logo_uploaded: true }),
    ]);
    const shown = Array.from(container.querySelectorAll('img'))
      .map((img) => img.getAttribute('src'));
    expect(shown).toContain('http://localhost:3000/brand/th-1/logo?v=2');
  });
});
