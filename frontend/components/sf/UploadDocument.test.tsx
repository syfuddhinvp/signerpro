/**
 * The document upload flow.
 *
 * The backend has always exposed `POST /api/documents/{id}/upload-pdf`, but no
 * screen ever opened a file picker — the library's "Upload & prepare" button
 * jumped to an empty builder that told the user to upload from the library.
 * These tests pin the flow that closes the loop, including the two failure
 * paths that would otherwise leave a fileless envelope behind.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider, useSF } from '@/lib/sf/state';
import { router, resetNavigation } from '@/test/navigation';
import UploadDocument from './UploadDocument';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const pdf = (name = 'MSA.pdf', bytes = 4) =>
  new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });

/* The toast lives in the app shell, which these tests do not mount, so the
   store's message is surfaced here instead. */
function Toast() {
  const { s } = useSF();
  return <output data-testid="toast">{s.toast ?? ''}</output>;
}

function mount(props: React.ComponentProps<typeof UploadDocument> = {}) {
  cleanup();
  return render(<SFProvider><UploadDocument {...props} /><Toast /></SFProvider>);
}

const toast = () => screen.getByTestId('toast').textContent;

const picker = () => screen.getByLabelText('Choose a file to upload') as HTMLInputElement;
const pick = (file: File) => fireEvent.change(picker(), { target: { files: [file] } });

/** `{ ok: true, data }` in the shape `ApiResult` uses. */
const ok = (data: unknown) => ({ ok: true, status: 200, data });
const fail = (message: string, status = 400) =>
  ({ ok: false, status, error: { kind: 'client', status, message } });

beforeEach(() => {
  apiCall.mockReset();
  resetNavigation();
});

describe('UploadDocument', () => {
  it('renders a real file input, not a dead button', () => {
    mount();
    expect(picker().type).toBe('file');
    expect(picker().accept).toContain('pdf');
    expect(screen.getByRole('button', { name: 'Upload & prepare' })).toBeTruthy();
  });

  it('creates the draft from the filename, uploads, and opens the builder', async () => {
    apiCall
      .mockResolvedValueOnce(ok({ id: 'doc_9' }))
      .mockResolvedValueOnce(ok({ document: { id: 'doc_9' }, sha256: 'abc', page_count: 3 }));
    mount();
    pick(pdf('Master services agreement.pdf'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/documents/doc_9/prepare'));
    expect(apiCall.mock.calls[0][0]).toBe('/api/documents');
    expect(apiCall.mock.calls[0][1].body).toEqual({ title: 'Master services agreement' });
    expect(apiCall.mock.calls[1][0]).toBe('/api/documents/doc_9/upload-pdf');
    expect(apiCall.mock.calls[1][1].formData.get('upload')).toBeInstanceOf(File);
  });

  it('uploads into an existing envelope without creating one', async () => {
    apiCall.mockResolvedValueOnce(ok({ document: { id: 'doc_1' }, sha256: 'a', page_count: 1 }));
    mount({ documentId: 'doc_1' });
    pick(pdf());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/documents/doc_1/prepare'));
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0][0]).toBe('/api/documents/doc_1/upload-pdf');
  });

  it('trashes the draft it just created when the upload is rejected', async () => {
    apiCall
      .mockResolvedValueOnce(ok({ id: 'doc_9' }))
      .mockResolvedValueOnce(fail('Uploaded file is not a valid PDF'))
      .mockResolvedValueOnce(ok(undefined));
    mount();
    pick(pdf());

    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(3));
    expect(apiCall.mock.calls[2]).toEqual(['/api/documents/doc_9', { method: 'DELETE', query: undefined }]);
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect(toast()).toBe('Uploaded file is not a valid PDF'));
  });

  it('never deletes an envelope it did not create', async () => {
    apiCall.mockResolvedValueOnce(fail('Original PDF cannot be overwritten', 409));
    mount({ documentId: 'doc_1' });
    pick(pdf());

    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1));
    expect(apiCall.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
  });

  it('refuses a non-PDF and an oversized file before calling the API', async () => {
    mount();
    pick(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(toast()).toBe('Only PDF files can be uploaded'));

    const huge = pdf('big.pdf');
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });
    pick(huge);
    await waitFor(() => expect(toast()).toBe('That PDF is larger than 25 MB'));
    expect(apiCall).not.toHaveBeenCalled();
  });
});
