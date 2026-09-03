'use client';

/**
 * Promise-based replacement for `window.prompt` / `window.confirm`.
 *
 * The browser primitives block the event loop, cannot be styled, are
 * suppressed outright in some embedded contexts (the signing iframe among
 * them), and are invisible to the screen-reader flow the rest of the chrome
 * maintains. `useDialogs()` hands back the same two questions as async calls
 * backed by a real modal built from the shared style atoms:
 *
 *   const { askText, askConfirm } = useDialogs();
 *   const name = await askText({ title: 'New folder', cta: 'Create' });
 *   if (await askConfirm({ title: 'Delete?', danger: true })) …
 *
 * `askText` resolves to the trimmed string, or `null` when dismissed —
 * matching `window.prompt`'s contract so call sites keep their null guard.
 * `askConfirm` resolves to a boolean. Escape, the ✕ and the backdrop all
 * dismiss; one dialog is open at a time and a second request replaces it
 * (the displaced promise resolves as dismissed).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, inputStyle } from '@/lib/sf/ui';

export type AskTextOptions = {
  title: string;
  message?: string;
  /** Field label. Defaults to the title, which reads fine for one input. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  cta?: string;
  /** Masks the input and turns off autofill — used by the password flows. */
  password?: boolean;
  /** Reject an empty submission instead of resolving with ''. */
  required?: boolean;
};

export type AskChoiceOption = { id: string; label: string };

/** A one-of-many question — "which folder?" — asked as a native select so it
 *  keeps keyboard and screen-reader behaviour for free. */
export type AskChoiceOptions = {
  title: string;
  message?: string;
  label?: string;
  options: AskChoiceOption[];
  defaultValue?: string;
  cta?: string;
};

export type AskConfirmOptions = {
  title: string;
  message?: string;
  cta?: string;
  cancel?: string;
  /** Renders the confirm button in the destructive tone. */
  danger?: boolean;
};

type TextRequest = { kind: 'text'; opts: AskTextOptions; resolve: (v: string | null) => void };
type ConfirmRequest = { kind: 'confirm'; opts: AskConfirmOptions; resolve: (v: boolean) => void };
type ChoiceRequest = { kind: 'choice'; opts: AskChoiceOptions; resolve: (v: string | null) => void };
type Request = TextRequest | ConfirmRequest | ChoiceRequest;

type DialogApi = {
  askText: (opts: AskTextOptions) => Promise<string | null>;
  askConfirm: (opts: AskConfirmOptions) => Promise<boolean>;
  askChoice: (opts: AskChoiceOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

/** Resolves a request as dismissed exactly once. */
function dismiss(req: Request): void {
  if (req.kind === 'confirm') req.resolve(false);
  else req.resolve(null);
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const { accent } = useSF();
  const A = accent();
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** The live request, so `close` never resolves a stale one twice. */
  const openRef = useRef<Request | null>(null);

  const open = useCallback((next: Request) => {
    const displaced = openRef.current;
    openRef.current = next;
    if (displaced) dismiss(displaced);
    setValue(
      next.kind === 'text' ? (next.opts.defaultValue ?? '')
        : next.kind === 'choice' ? (next.opts.defaultValue ?? next.opts.options[0]?.id ?? '')
          : '');
    setReq(next);
  }, []);

  /** Settles the open request and tears the dialog down. */
  const close = useCallback((settle: (req: Request) => void) => {
    const current = openRef.current;
    openRef.current = null;
    setReq(null);
    setValue('');
    if (current) settle(current);
  }, []);

  const api = useMemo<DialogApi>(() => ({
    askText: opts => new Promise<string | null>(resolve => { open({ kind: 'text', opts, resolve }); }),
    askConfirm: opts => new Promise<boolean>(resolve => { open({ kind: 'confirm', opts, resolve }); }),
    askChoice: opts => new Promise<string | null>(resolve => { open({ kind: 'choice', opts, resolve }); }),
  }), [open]);

  /* Focus the input (or the confirm button) when a dialog appears. */
  useEffect(() => {
    if (req?.kind === 'text') inputRef.current?.focus();
  }, [req]);

  /* Escape dismisses even when focus never entered the card. */
  useEffect(() => {
    if (!req) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close(dismiss);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); };
  }, [req, close]);

  /* A provider unmount must not leave an awaiting caller hanging forever. */
  useEffect(() => () => {
    const current = openRef.current;
    openRef.current = null;
    if (current) dismiss(current);
  }, []);

  const trimmed = value.trim();
  const submitDisabled = (req?.kind === 'text' && !!req.opts.required && !trimmed)
    || (req?.kind === 'choice' && !trimmed);

  const submit = () => {
    const current = openRef.current;
    if (!current) return;
    if (current.kind === 'text') {
      if (current.opts.required && !trimmed) return;
      close(r => { if (r.kind === 'text') r.resolve(trimmed); });
      return;
    }
    if (current.kind === 'choice') {
      if (!trimmed) return;
      close(r => { if (r.kind === 'choice') r.resolve(trimmed); });
      return;
    }
    close(r => { if (r.kind === 'confirm') r.resolve(true); });
  };

  const cancel = () => { close(dismiss); };

  const cardStyle: CSSProperties = {
    width: '420px', maxWidth: '100%', background: '#fff', borderRadius: '16px',
    boxShadow: '0 40px 90px -30px rgba(15,23,42,.6)', animation: 'sfIn .16s ease',
  };
  const ghost = btn('#fff', '#475569', '#e3e7ee');
  const confirmTone = req?.kind === 'confirm' && req.opts.danger
    ? btn('#b91c1c', '#fff', '#b91c1c')
    : btn(A, '#fff', A);
  const ctaStyle: CSSProperties = submitDisabled
    ? Object.assign({}, confirmTone, { opacity: .5, cursor: 'not-allowed' })
    : confirmTone;
  const closeBtn: CSSProperties = {
    width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
    background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '.8125rem', lineHeight: 1, flex: '0 0 28px',
  };

  const cta = req
    ? (req.kind === 'confirm' ? (req.opts.cta ?? 'Confirm') : (req.opts.cta ?? 'Save'))
    : '';
  const cancelLabel = req?.kind === 'confirm' ? (req.opts.cancel ?? 'Cancel') : 'Cancel';
  const fieldLabel = req && req.kind !== 'confirm' ? (req.opts.label ?? req.opts.title) : '';

  return (
    <DialogContext.Provider value={api}>
      {children}
      {req ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={req.opts.title}
          data-sf-modal-open=""
          onClick={event => { if (event.target === event.currentTarget) cancel(); }}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: '24px' }}
        >
          <form
            style={cardStyle}
            onSubmit={event => { event.preventDefault(); submit(); }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', padding: '16px 18px', borderBottom: '1px solid #eef1f6' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>{req.opts.title}</span>
                {req.opts.message ? (
                  <span style={{ fontSize: '.75rem', color: '#64748b' }}>{req.opts.message}</span>
                ) : null}
              </div>
              <button type="button" aria-label="Close" onClick={cancel} style={closeBtn}>✕</button>
            </div>

            {req.kind === 'text' ? (
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  htmlFor="sf-dialog-input"
                  style={{ fontSize: '.6875rem', letterSpacing: '.04em', textTransform: 'uppercase', color: '#64748b', fontWeight: 500 }}
                >{fieldLabel}</label>
                <input
                  id="sf-dialog-input"
                  ref={inputRef}
                  type={req.opts.password ? 'password' : 'text'}
                  autoComplete={req.opts.password ? 'off' : undefined}
                  value={value}
                  placeholder={req.opts.placeholder}
                  onChange={event => setValue(event.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : null}

            {req.kind === 'choice' ? (
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label
                  htmlFor="sf-dialog-choice"
                  style={{ fontSize: '.6875rem', letterSpacing: '.04em', textTransform: 'uppercase', color: '#64748b', fontWeight: 500 }}
                >{fieldLabel}</label>
                <select
                  id="sf-dialog-choice"
                  value={value}
                  onChange={event => setValue(event.target.value)}
                  style={inputStyle}
                >
                  {req.opts.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 18px', borderTop: '1px solid #eef1f6' }}>
              <button type="button" onClick={cancel} style={ghost}>{cancelLabel}</button>
              <button type="submit" disabled={submitDisabled} style={ctaStyle}>{cta}</button>
            </div>
          </form>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

/**
 * The dialog API. Throws when used outside the provider rather than silently
 * degrading — a missing provider means the question would never be asked.
 */
export function useDialogs(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialogs() requires <DialogProvider>');
  return api;
}
