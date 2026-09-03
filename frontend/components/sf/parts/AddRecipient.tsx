'use client';

/**
 * "Add recipient" — the inline form behind the builder's Recipients rail and
 * the workflow step's recipient list.
 *
 * Until now the prepare screen could reorder and re-role the recipients an
 * envelope already had, but there was no way to put one *on* it: a freshly
 * uploaded PDF was stuck with an empty list and `POST/PUT .../recipients` was
 * unreachable from the UI.
 *
 * Email is the only thing asked for — it is what identifies a recipient, and
 * `displayNameFromEmail` covers the required API name when the sender does not
 * type one. Both fields stay free text: the suggestion list below the address is
 * a shortcut into the tenant's contacts, never a constraint on what can be
 * typed. Picking a suggestion fills in that contact's *address* (and name), so
 * what the form submits is always a plain email, never an id.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { btn, inputStyle, TEXT_MUTED } from '@/lib/sf/ui';
import { searchContacts, type ContactSuggestion } from '@/lib/sf/recipientContacts';

/** Same shape the API enforces; caught here so a typo is not a round trip. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Keystrokes settle before the address book is queried. */
const SUGGEST_DELAY_MS = 180;

export type AddRecipientProps = {
  accent: string;
  /** Adds the recipient. Return false to keep the form open (a duplicate, a
   *  failed write) — true clears and closes it. `name` may be empty. */
  onAdd: (name: string, email: string) => boolean | Promise<boolean>;
  /** `rail` is the narrow left column; `row` is the wider workflow card. */
  variant?: 'rail' | 'row';
  disabled?: boolean;
};

export default function AddRecipient({ accent, onAdd, variant = 'rail', disabled = false }: AddRecipientProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<ContactSuggestion[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const [active, setActive] = useState(-1);
  const emailRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const listId = useId();
  /* A pick must not immediately re-open the list from its own `setEmail`. */
  const justPicked = useRef(false);

  const reset = () => {
    setName(''); setEmail(''); setError(null);
    setMatches([]); setShowMatches(false); setActive(-1);
  };

  /* Suggestions follow the address field. */
  useEffect(() => {
    if (!open) return;
    if (justPicked.current) { justPicked.current = false; return; }
    let live = true;
    const timer = setTimeout(() => {
      void searchContacts(email).then(rows => {
        if (!live) return;
        setMatches(rows);
        setActive(-1);
      });
    }, SUGGEST_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [email, open]);

  const pick = useCallback((row: ContactSuggestion) => {
    justPicked.current = true;
    // The email, never the id — that is what the recipient is created from.
    setEmail(row.email);
    // Only fill a name the sender has not written themselves.
    setName(current => (current.trim() ? current : row.name));
    setShowMatches(false);
    setActive(-1);
    setError(null);
    emailRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy) return;
    const cleanEmail = email.trim();
    if (!EMAIL.test(cleanEmail)) { setError('Enter an email address'); return; }
    setError(null);
    setBusy(true);
    try {
      const added = await onAdd(name.trim(), cleanEmail);
      if (!added) return;
      reset();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  /** Arrow keys walk the suggestions; Enter takes the highlighted one, or submits. */
  const onEmailKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const visible = showMatches && matches.length > 0;
    if (e.key === 'ArrowDown' && visible) { e.preventDefault(); setActive(i => (i + 1) % matches.length); return; }
    if (e.key === 'ArrowUp' && visible) { e.preventDefault(); setActive(i => (i <= 0 ? matches.length - 1 : i - 1)); return; }
    if (e.key === 'Enter') {
      if (visible && active > -1) { e.preventDefault(); pick(matches[active]); return; }
      void submit();
      return;
    }
    if (e.key === 'Escape') {
      if (visible) { setShowMatches(false); return; }
      reset(); setOpen(false);
    }
  };

  const openBtn: CSSProperties = Object.assign(
    btn('#fff', accent, '#e3e7ee'),
    { width: '100%', justifyContent: 'center' } as CSSProperties,
    disabled ? { opacity: .55, cursor: 'not-allowed' } : null,
  );

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? 'Open a document first' : undefined}
        onClick={() => { setOpen(true); setShowMatches(true); setTimeout(() => emailRef.current?.focus(), 0); }}
        style={openBtn}
      >+ Add recipient</button>
    );
  }

  const stack: CSSProperties = variant === 'rail'
    ? { display: 'flex', flexDirection: 'column', gap: '6px' }
    : { display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) auto', gap: '6px', alignItems: 'start' };

  const suggestionsVisible = showMatches && matches.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={stack}>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <input
            ref={emailRef}
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setShowMatches(true); }}
            onFocus={() => setShowMatches(true)}
            /* A click on a suggestion blurs the input first, so closing is
               deferred past the pointer-up that selects the row. */
            onBlur={() => setTimeout(() => setShowMatches(false), 120)}
            onKeyDown={onEmailKey}
            placeholder="name@company.com"
            aria-label="Recipient email"
            role="combobox"
            aria-expanded={suggestionsVisible}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={suggestionsVisible && active > -1 ? listId + '-' + active : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            style={inputStyle}
          />
          {suggestionsVisible ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching contacts"
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, margin: 0,
                padding: '4px', listStyle: 'none', background: '#fff', border: '1px solid #e3e7ee',
                borderRadius: '11px', boxShadow: '0 18px 40px -18px rgba(15,23,42,.4)', maxHeight: '212px', overflow: 'auto',
              }}
            >
              {matches.map((row, i) => (
                <li key={row.id} role="none">
                  <button
                    type="button"
                    id={listId + '-' + i}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(row)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px', width: '100%',
                      padding: '6px 8px', borderRadius: '8px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: i === active ? '#eef2ff' : 'transparent',
                    }}
                  >
                    <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#0f172a' }}>{row.name}</span>
                    <span style={{ fontSize: '.6875rem', color: TEXT_MUTED }}>{row.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') { reset(); setOpen(false); } }}
          placeholder="Name (optional)"
          aria-label="Recipient name (optional)"
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" onClick={() => void submit()} disabled={busy} style={btn(accent, '#fff', accent)}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={() => { reset(); setOpen(false); }} style={btn('#fff', '#475569', '#e3e7ee')}>Cancel</button>
        </div>
      </div>
      {error ? (
        <span id={errorId} role="alert" style={{ fontSize: '.6875rem', color: '#b91c1c' }}>{error}</span>
      ) : (
        <span style={{ fontSize: '.6875rem', color: TEXT_MUTED }}>
          Email is enough — they are added as a signer and saved to your contacts.
        </span>
      )}
    </div>
  );
}
