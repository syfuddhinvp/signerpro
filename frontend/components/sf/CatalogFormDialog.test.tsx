/**
 * Creating a custom catalog form.
 *
 * The property worth pinning hardest is what happens when the PDF upload
 * fails after the entry was already created: the entry exists, and saying
 * "failed" would send the curator off to create a duplicate.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resetNavigation } from '@/test/navigation';
import { SFProvider, useSF } from '@/lib/sf/state';
import type { CatalogTemplateResponse } from '@/lib/api/types';
import CatalogFormDialog from './CatalogFormDialog';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

const onClose = vi.fn();
const onSaved = vi.fn();

function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

function mount(entry: CatalogTemplateResponse | null = null) {
  return render(
    <SFProvider>
      <CatalogFormDialog entry={entry} onClose={onClose} onSaved={onSaved} />
      <Toast />
    </SFProvider>,
  );
}

const existing = (over: Partial<CatalogTemplateResponse> = {}): CatalogTemplateResponse => ({
  id: 'c1',
  slug: 'irs-w9',
  title: 'IRS Form W-9',
  description: 'Taxpayer identification.',
  category: 'government',
  authority: 'IRS',
  jurisdiction: 'US',
  form_revision: 'Rev. October 2018',
  tags: [],
  page_count: 1,
  role_count: 1,
  field_count: 6,
  has_file: true,
  published: true,
  sort_order: 10,
  imported: false,
  created_at: '2026-09-06T09:00:00Z',
  updated_at: '2026-09-06T09:00:00Z',
  ...over,
});

/** The body of the PATCH that updated the entry. */
const patchedBody = () =>
  (apiCall.mock.calls.find(c => c[0] === '/api/platform/catalog-templates/c1')?.[1] as { body?: Record<string, unknown> })?.body;

const toast = () => screen.getByTestId('toast').textContent ?? '';
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
/* Several labels carry helper copy under the control, so their accessible
   name is the whole block; match on how each one starts. */
const control = (label: string) => screen.getByLabelText(new RegExp('^' + label));
const type = (label: string, value: string) =>
  fireEvent.change(control(label), { target: { value } });

/** The body of the POST that created the entry. */
const createdBody = () =>
  (apiCall.mock.calls.find(c => c[0] === '/api/platform/catalog-templates')?.[1] as { body?: Record<string, unknown> })?.body;

const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'w9.pdf', { type: 'application/pdf' });

function choosePdf(file = pdf()) {
  const input = control('Form PDF') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetNavigation();
  apiCall.mockResolvedValue(ok({ id: 'c1', title: 'State tax form' }));
});

describe('creating a custom catalog form', () => {
  it('derives the handle from the title', async () => {
    mount();
    type('Title', 'State Tax Form 2026');
    expect((control('Handle') as HTMLInputElement).value).toBe('state-tax-form-2026');
  });

  it('stops deriving the handle once the curator writes their own', () => {
    mount();
    type('Title', 'State Tax Form');
    type('Handle', 'st-2026');
    type('Title', 'State Tax Form (revised)');
    expect((control('Handle') as HTMLInputElement).value).toBe('st-2026');
  });

  it('creates the entry with its metadata, unpublished and unplaced', async () => {
    mount();
    type('Title', 'State tax form');
    type('Description', 'Withholding for state income tax.');
    fireEvent.change(control('Category'), { target: { value: 'finance' } });
    type('Issuing body', 'State Revenue');
    type('Jurisdiction', 'US-CA');
    create();

    await waitFor(() => expect(createdBody()).toMatchObject({
      slug: 'state-tax-form',
      title: 'State tax form',
      description: 'Withholding for state income tax.',
      category: 'finance',
      authority: 'State Revenue',
      jurisdiction: 'US-CA',
      // Placement is drawn in the builder afterwards, and nothing reaches
      // tenants until a curator publishes it.
      roles: [],
      fields: [],
      published: false,
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('uploads the PDF to the entry it just created', async () => {
    mount();
    type('Title', 'State tax form');
    choosePdf();
    create();

    await waitFor(() => {
      const upload = apiCall.mock.calls.find(c => String(c[0]).endsWith('/file'));
      expect(upload?.[0]).toBe('/api/platform/catalog-templates/c1/file');
    });
  });

  it('keeps the entry when its PDF fails to upload, and says so', async () => {
    mount();
    type('Title', 'State tax form');
    choosePdf();
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(String(path).endsWith('/file') ? fail('PDF could not be read') : ok({ id: 'c1' })),
    );
    create();

    await waitFor(() => expect(toast()).toMatch(/created, but its PDF did not upload/));
    // The entry exists, so the screen must refresh to show it as "Needs a PDF"
    // rather than leave the curator to create a duplicate.
    expect(onSaved).toHaveBeenCalled();
  });

  it('allows a form with no PDF yet and says what is left to do', async () => {
    mount();
    type('Title', 'State tax form');
    create();
    await waitFor(() => expect(toast()).toMatch(/upload its PDF next/));
    expect(apiCall.mock.calls.filter(c => String(c[0]).endsWith('/file'))).toHaveLength(0);
  });

  it('refuses to submit without a title, without calling the API', async () => {
    mount();
    create();
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the form a title');
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('reports a rejected slug in place rather than closing', async () => {
    mount();
    type('Title', 'State tax form');
    apiCall.mockResolvedValue(fail("Slug 'state-tax-form' is already in use"));
    create();

    expect(await screen.findByRole('alert')).toHaveTextContent('already in use');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file before anything is created', async () => {
    mount();
    choosePdf(new File([new Uint8Array([1])], 'form.zip', { type: 'application/zip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be uploaded/);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('closes on cancel and on Escape', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose.mock.calls.length).toBeGreaterThan(1);
  });
});


describe('editing an existing catalog form', () => {
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

  it('opens prefilled with what the entry already says', () => {
    mount(existing());
    expect((control('Title') as HTMLInputElement).value).toBe('IRS Form W-9');
    expect((control('Description') as HTMLTextAreaElement).value).toBe('Taxpayer identification.');
    expect((control('Category') as HTMLSelectElement).value).toBe('government');
    expect((control('Issuing body') as HTMLInputElement).value).toBe('IRS');
    expect((control('Jurisdiction') as HTMLInputElement).value).toBe('US');
    expect((control('Form revision') as HTMLInputElement).value).toBe('Rev. October 2018');
  });

  it('patches only the metadata, leaving placement and publish state alone', async () => {
    mount(existing());
    type('Title', 'IRS Form W-9 (2026)');
    type('Issuing body', 'Internal Revenue Service');
    save();

    await waitFor(() => expect(patchedBody()).toEqual({
      title: 'IRS Form W-9 (2026)',
      description: 'Taxpayer identification.',
      category: 'government',
      authority: 'Internal Revenue Service',
      jurisdiction: 'US',
      form_revision: 'Rev. October 2018',
    }));
    // Nothing here may quietly republish, reshape or re-file the form.
    const body = patchedBody() as Record<string, unknown>;
    expect(body).not.toHaveProperty('published');
    expect(body).not.toHaveProperty('roles');
    expect(body).not.toHaveProperty('fields');
    expect(body).not.toHaveProperty('slug');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('never creates a second entry while editing', async () => {
    mount(existing());
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiCall.mock.calls.filter(c => c[0] === '/api/platform/catalog-templates')).toHaveLength(0);
  });

  it('fixes the handle, because drafts authored for the form refer to it', () => {
    mount(existing());
    const handle = control('Handle') as HTMLInputElement;
    expect(handle.value).toBe('irs-w9');
    expect(handle.readOnly).toBe(true);
    // Retyping the title must not drag the handle along with it.
    type('Title', 'Something Else Entirely');
    expect((control('Handle') as HTMLInputElement).value).toBe('irs-w9');
  });

  it('does not offer the PDF here — the row has its own Replace PDF', () => {
    mount(existing());
    expect(screen.queryByLabelText(/^Form PDF/)).toBeNull();
  });

  it('clears a field the curator emptied rather than sending a blank string', async () => {
    mount(existing());
    type('Issuing body', '   ');
    save();
    await waitFor(() => expect(patchedBody()).toMatchObject({ authority: null }));
  });

  it('reports a rejected edit in place rather than closing', async () => {
    mount(existing());
    apiCall.mockResolvedValue(fail('category must be one of [...]'));
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('category must be one of');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
