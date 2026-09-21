'use client';

/**
 * The platform compose window: a modal, laid out the way a mail client lays
 * one out.
 *
 * It replaced a panel that pushed the mailbox down the page. The panel was
 * fine for two fields and a body; it stops being fine once composing means
 * Cc, Bcc and files, because the list and reading pane below it end up
 * scrolled off screen while the admin is still writing — and the thing an
 * admin usually wants while composing is the message they are answering.
 *
 * Three decisions worth keeping:
 *
 *  - Cc and Bcc are hidden until asked for, as every mail client hides them.
 *    Three address fields on open reads as three fields that want filling in.
 *  - Files are read into base64 here and posted with the message, rather than
 *    uploaded first to a staging endpoint. A composed message is sent once and
 *    the files exist only for it; a staging store would then need its own
 *    lifecycle to clean up the attachments of a message nobody ever sent.
 *  - The window survives a partial send. The error is shown in place with the
 *    message still in it, because re-sending to everybody double-mails whoever
 *    was already reached.
 */

import type { CSSProperties } from 'react';
import { useCallback, useRef, useState } from 'react';
import { apiCall } from '@/lib/api/browser';
import { mail as mailApi } from '@/lib/api/resources';
import { useSF } from '@/lib/sf/state';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';
import { btn, TEXT_MUTED } from '@/lib/sf/ui';
import type { MailAttachment } from '@/lib/api/types';
import Icon from '@/components/sf/Icon';

/** Mirrors `MAX_ATTACHMENT_BYTES` / `MAX_ATTACHMENTS_TOTAL_BYTES` on the API,
 *  so an oversized file is refused here rather than after a 10 MB upload. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

type Attached = MailAttachment & { size: number };

/** `data:<type>;base64,<payload>` → the payload alone, which is what the API
 *  takes: the prefix restates a content type the request already carries. */
function readAsBase64(file: File): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read`));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        content: result.slice(result.indexOf(',') + 1),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Comma, semicolon or newline: an admin pasting a list from anywhere else
 *  should not have to reformat it first. */
function addresses(value: string): string[] {
  return value.split(/[,;\n]/).map(a => a.trim()).filter(Boolean);
}

export type MailComposerProps = {
  onClose: () => void;
  /** Called after a send that reached every addressee, to refresh the list. */
  onSent: () => void;
};

const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  borderBottom: '1px solid hsl(var(--color-border-hairline))', padding: '0 16px', minHeight: '42px',
};

/* Underlined-row fields, not bordered boxes: the header of a compose window is
   a list of addresses, and boxing each one makes it read as a form. */
const FIELD: CSSProperties = {
  flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
  fontSize: '.8125rem', color: 'hsl(var(--color-fg-default))', fontFamily: 'inherit', padding: '10px 0',
};

const FIELD_LABEL: CSSProperties = {
  flex: '0 0 auto', fontSize: '.75rem', color: TEXT_MUTED, width: '46px',
};

export default function MailComposer({ onClose, onSent }: MailComposerProps) {
  const { flash, accent } = useSF();
  const A = accent();
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useModalBehaviour<HTMLDivElement>(true, close);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendHtml, setSendHtml] = useState(true);
  const [files, setFiles] = useState<Attached[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);

  const attach = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    /* Cleared straight away so picking the same file twice still fires a
       change event — a re-attach after removing one is an ordinary thing. */
    event.target.value = '';
    if (!chosen.length) return;

    const oversized = chosen.find(f => f.size > MAX_FILE_BYTES);
    if (oversized) { setError(`${oversized.name} is larger than 5 MB.`); return; }
    if (files.length + chosen.length > MAX_FILES) {
      setError(`A message carries at most ${MAX_FILES} files.`);
      return;
    }
    const total = [...files, ...chosen].reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) { setError('Attachments come to more than 10 MB in total.'); return; }

    setError(null);
    void Promise.all(chosen.map(readAsBase64))
      .then(read => setFiles(now => [...now, ...read]))
      .catch((err: Error) => setError(err.message));
  }, [files]);

  const remove = useCallback((index: number) => {
    setFiles(current => current.filter((_, i) => i !== index));
  }, []);

  const send = useCallback(() => {
    const recipients = addresses(to);
    if (!recipients.length) { setError('Add at least one recipient.'); return; }
    if (!subject.trim()) { setError('Add a subject.'); return; }
    if (!body.trim()) { setError('The message is empty.'); return; }

    setSending(true);
    setError(null);
    void mailApi.send(apiCall, {
      to: recipients,
      cc: addresses(cc),
      bcc: addresses(bcc),
      subject: subject.trim(),
      body,
      send_html: sendHtml,
      attachments: files.map(({ filename, content_type, content }) => ({ filename, content_type, content })),
    }).then(res => {
      setSending(false);
      if (!res.ok) { setError(res.error.message); return; }
      const { sent, failed } = res.data;
      if (failed) {
        /* Stays open, still holding the message: a toast that says "1 failed"
           and disappears leaves an admin with no way to tell which recipients
           were reached, and re-sending to all of them double-mails the rest.
           The outbox rows carry the provider's reason. */
        setError(`Sent to ${sent}. Failed for ${failed} — the rows carry the provider's reason.`);
        onSent();
        return;
      }
      flash(`Sent to ${sent} recipient${sent === 1 ? '' : 's'}.`);
      onSent();
      onClose();
    });
  }, [bcc, body, cc, files, flash, onClose, onSent, sendHtml, subject, to]);

  const toggle = (on: boolean): CSSProperties => ({
    border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 2px',
    fontSize: '.75rem', fontWeight: on ? 600 : 500, color: on ? 'hsl(var(--color-fg-default))' : TEXT_MUTED,
    display: 'inline-flex', alignItems: 'center', gap: '3px',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        style={{
          background: 'hsl(var(--color-bg-surface))', borderRadius: '16px', border: '1px solid hsl(var(--color-border-subtle))',
          width: 'min(720px, 100%)', maxHeight: 'min(88vh, 860px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(15,23,42,.24)',
        }}
      >
        <header style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 16px', background: 'hsl(var(--color-bg-muted))', borderBottom: '1px solid hsl(var(--color-border-subtle))',
        }}>
          <h2 id="compose-title" style={{ margin: 0, flex: 1, fontSize: '.875rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))' }}>
            New message
          </h2>
          <button type="button" onClick={close} aria-label="Close composer"
            style={{ ...btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'), padding: '0 10px' }}>
            <Icon name="close" size={13} />Close
          </button>
        </header>

        <div style={ROW}>
          <span style={FIELD_LABEL} id="compose-to-label">To</span>
          <input value={to} onChange={e => setTo(e.target.value)} aria-labelledby="compose-to-label"
            placeholder="ada@acme.com, ops@acme.com" style={FIELD} />
          <span style={{ display: 'flex', gap: '10px', flex: '0 0 auto' }}>
            {showCc ? null : <button type="button" onClick={() => setShowCc(true)} style={toggle(false)}><Icon name="plus" size={10} />Cc</button>}
            {showBcc ? null : <button type="button" onClick={() => setShowBcc(true)} style={toggle(false)}><Icon name="plus" size={10} />Bcc</button>}
          </span>
        </div>

        {showCc ? (
          <div style={ROW}>
            <span style={FIELD_LABEL} id="compose-cc-label">Cc</span>
            <input value={cc} onChange={e => setCc(e.target.value)} aria-labelledby="compose-cc-label" autoFocus style={FIELD} />
          </div>
        ) : null}

        {showBcc ? (
          <div style={ROW}>
            <span style={FIELD_LABEL} id="compose-bcc-label">Bcc</span>
            <input value={bcc} onChange={e => setBcc(e.target.value)} aria-labelledby="compose-bcc-label" autoFocus style={FIELD} />
          </div>
        ) : null}

        <div style={ROW}>
          <span style={FIELD_LABEL} id="compose-subject-label">Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} aria-labelledby="compose-subject-label" placeholder="Scheduled maintenance on Sunday" style={FIELD} />
        </div>

        <div style={{ flex: 1, minHeight: '180px', display: 'flex', overflow: 'auto' }}>
          <textarea value={body} onChange={e => setBody(e.target.value)} aria-label="Message"
            placeholder={'Hello,\n\nA blank line starts a new paragraph.'}
            style={{
              flex: 1, border: 'none', outline: 'none', resize: 'none', padding: '14px 16px',
              fontSize: '.8125rem', lineHeight: 1.7, color: 'hsl(var(--color-fg-default))', background: 'hsl(var(--color-bg-surface))',
              fontFamily: 'inherit', textTransform: 'none', letterSpacing: 'normal',
            }} />
        </div>

        {files.length ? (
          <ul style={{
            listStyle: 'none', margin: 0, padding: '10px 16px', display: 'flex', flexWrap: 'wrap',
            gap: '8px', borderTop: '1px solid hsl(var(--color-border-hairline))',
          }}>
            {files.map((file, i) => (
              <li key={`${file.filename}-${i}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', maxWidth: '100%',
                border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '9px', padding: '5px 8px 5px 10px',
                background: 'hsl(var(--color-bg-subtle))', fontSize: '.71875rem', color: 'hsl(var(--color-fg-subtle))',
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.filename}</span>
                <span style={{ color: TEXT_MUTED, flex: '0 0 auto' }}>{humanSize(file.size)}</span>
                <button type="button" onClick={() => remove(i)} aria-label={`Remove ${file.filename}`}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TEXT_MUTED, fontSize: '.875rem', lineHeight: 1 }}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p role="alert" style={{
            margin: 0, padding: '9px 16px', background: 'hsl(var(--color-bg-danger-subtle))', borderTop: '1px solid hsl(var(--color-border-danger))',
            color: 'hsl(var(--color-fg-danger))', fontSize: '.75rem', lineHeight: 1.6,
          }}>
            {error}
          </p>
        ) : null}

        <footer style={{
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          padding: '12px 16px', borderTop: '1px solid hsl(var(--color-border-subtle))', background: '#fafbfd',
        }}>
          <button type="button" onClick={send} disabled={sending}
            style={{ ...btn(A, 'hsl(var(--color-fg-on-solid))', A), opacity: sending ? .6 : 1 }}>
            <Icon name="send" size={13} />{sending ? 'Sending…' : 'Send'}
          </button>

          <input ref={fileInput} type="file" multiple onChange={attach}
            style={{ display: 'none' }} data-testid="compose-file-input" />
          <button type="button" onClick={() => fileInput.current?.click()}
            style={{ ...btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'), padding: '0 12px' }}>
            <Icon name="upload" size={13} />Attach files
          </button>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '.75rem', color: 'hsl(var(--color-fg-subtle))' }}>
            <input type="checkbox" checked={sendHtml} onChange={e => setSendHtml(e.target.checked)} />
            Also send a branded HTML part
          </label>

          <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, flex: 1, minWidth: '180px' }}>
            Sent as plain text with paragraphs. Your text is escaped, never treated as markup.
          </span>
        </footer>
      </div>
    </div>
  );
}
