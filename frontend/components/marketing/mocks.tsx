/**
 * Product mocks for the marketing pages.
 *
 * These stand in for screenshots until `scripts/marketing-screenshots.mjs` has
 * been run against a seeded workspace. They exist because the alternative was
 * what the pages shipped with first: an empty grey rectangle in a browser
 * frame, which is worse than no image at all — it reads as a broken asset and
 * it tells a visitor nothing.
 *
 * They are drawn from the same tokens as the rest of the site, so they are
 * legible in both themes and cannot drift from the palette. Each one holds the
 * aspect ratio its real screenshot will have, so swapping them out later moves
 * no layout (CLS).
 *
 * Rule: a mock may only show a screen the product actually has. Every one below
 * names its `FEATURES.md` section.
 */
import type { ReactNode } from 'react';
import { cx } from './primitives';

/* ── shared furniture ────────────────────────────────────────────────────── */

/** The panel every mock sits in: fixed ratio, quiet background, small type. */
function Panel({
  children,
  ratio = 'aspect-[4/3]',
  title,
  action,
}: {
  children: ReactNode;
  ratio?: string;
  title?: string;
  action?: string;
}) {
  return (
    <div className={cx('flex flex-col overflow-hidden bg-mk-card', ratio)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-mk-hairline px-4 py-2.5">
          <span className="truncate text-mk-copy-sm font-bold text-mk-ink">{title}</span>
          {action ? (
            <span className="shrink-0 rounded-mk-chip bg-mk-action px-2.5 py-1 text-[11px] font-bold text-mk-action-ink">
              {action}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden p-4">{children}</div>
    </div>
  );
}

/** A grey bar standing in for a line of body text. */
function Line({ w = '100%', className }: { w?: string; className?: string }) {
  return (
    <span
      className={cx('block h-2 rounded-full bg-mk-canvas-sunken', className)}
      style={{ width: w }}
    />
  );
}

/** A person's initial in a circle. */
function Avatar({ initial, tone = 'action' }: { initial: string; tone?: 'action' | 'sealed' | 'muted' }) {
  const tones = {
    action: 'bg-mk-action text-mk-action-ink',
    sealed: 'bg-mk-sealed text-white',
    muted: 'bg-mk-canvas-sunken text-mk-ink-muted',
  }[tone];
  return (
    <span
      aria-hidden="true"
      className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold', tones)}
    >
      {initial}
    </span>
  );
}

/** A status pill. */
function Status({ label, tone }: { label: string; tone: 'sealed' | 'action' | 'muted' }) {
  const tones = {
    sealed: 'bg-mk-sealed-subtle text-mk-sealed-fg',
    action: 'bg-mk-action-subtle text-mk-action-fg',
    muted: 'bg-mk-canvas-alt text-mk-ink-subtle',
  }[tone];
  return (
    <span className={cx('shrink-0 rounded-mk-chip px-2 py-0.5 text-[11px] font-semibold', tones)}>
      {label}
    </span>
  );
}

/** A labelled row with a value on the right. */
function Row({
  children,
  value,
  strong = false,
}: {
  children: ReactNode;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-mk-hairline py-2 last:border-b-0">
      <span className="truncate text-mk-copy-sm text-mk-ink-muted">{children}</span>
      <span
        className={cx(
          'shrink-0 text-mk-copy-sm',
          strong ? 'font-bold text-mk-ink' : 'text-mk-ink',
        )}
        data-sf-num
      >
        {value}
      </span>
    </div>
  );
}

/* ── the mocks ───────────────────────────────────────────────────────────── */

/** Payments — FEATURES.md §7. A request split across two recipients. */
export function PaymentsMock() {
  return (
    <Panel title="Deposit — Master services agreement" action="Paid">
      <div className="flex h-full flex-col">
        <div className="mb-3 rounded-mk-card border border-mk-sealed-border bg-mk-sealed-subtle px-4 py-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-mk-sealed-fg">
            Collected at signature
          </p>
          <p className="m-0 text-mk-display-sm font-bold text-mk-sealed-fg" data-sf-num>
            $1,500.00
          </p>
        </div>

        <p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mk-ink-subtle">
          Split across recipients
        </p>
        <div className="mb-3">
          <Row value="$900.00" strong>
            Dana Reyes
          </Row>
          <Row value="$600.00" strong>
            Michael Osei
          </Row>
        </div>

        <div className="mt-auto flex items-center gap-2">
          <Status label="Succeeded" tone="sealed" />
          <span className="text-[11px] text-mk-ink-subtle">Stripe · your account</span>
        </div>
      </div>
    </Panel>
  );
}

/** Routing — FEATURES.md §5. Sequential order with live statuses. */
export function RoutingMock() {
  const recipients = [
    { n: '1', name: 'Dana Reyes', role: 'Signer', status: 'Completed', tone: 'sealed' as const, avatar: 'sealed' as const },
    { n: '2', name: 'Michael Osei', role: 'Signer', status: 'Waiting', tone: 'action' as const, avatar: 'action' as const },
    { n: '3', name: 'Priya Nair', role: 'Approver', status: 'Not yet', tone: 'muted' as const, avatar: 'muted' as const },
    { n: '—', name: 'accounts@acme.com', role: 'Copy', status: 'Notified', tone: 'muted' as const, avatar: 'muted' as const },
  ];
  return (
    <Panel title="Signing order" action="Sequential">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {recipients.map(person => (
          <li
            key={person.name}
            className="flex items-center gap-2.5 rounded-mk-card border border-mk-hairline px-3 py-2"
          >
            <span
              aria-hidden="true"
              className="w-3 shrink-0 text-[11px] font-bold text-mk-ink-subtle"
            >
              {person.n}
            </span>
            <Avatar initial={person.name[0]} tone={person.avatar} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-mk-copy-sm font-semibold text-mk-ink">
                {person.name}
              </span>
              <span className="block text-[11px] text-mk-ink-subtle">{person.role}</span>
            </span>
            <Status label={person.status} tone={person.tone} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Audit trail — FEATURES.md §8. Timestamped events with a hash. */
export function AuditMock() {
  const events = [
    { t: '14:02:11', who: 'Dana Reyes', what: 'Signature added', tone: 'sealed' as const },
    { t: '14:01:48', who: 'Dana Reyes', what: 'Payment succeeded', tone: 'sealed' as const },
    { t: '13:58:02', who: 'Dana Reyes', what: 'Disclosure accepted', tone: 'action' as const },
    { t: '13:57:40', who: 'Dana Reyes', what: 'Document opened', tone: 'muted' as const },
    { t: '13:55:09', who: 'You', what: 'Sent for signature', tone: 'muted' as const },
  ];
  return (
    <Panel title="Audit trail" action="Sealed">
      <div className="flex h-full flex-col">
        <ul className="m-0 flex list-none flex-col p-0">
          {events.map(event => (
            <li
              key={event.t}
              className="flex items-center gap-3 border-b border-mk-hairline py-2 last:border-b-0"
            >
              <span className="shrink-0 text-[11px] tabular-nums text-mk-ink-subtle" data-sf-num>
                {event.t}
              </span>
              <span className="min-w-0 flex-1 truncate text-mk-copy-sm text-mk-ink">
                {event.what}
              </span>
              <span className="shrink-0 text-[11px] text-mk-ink-subtle">{event.who}</span>
            </li>
          ))}
        </ul>
        <p className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-mk-ink-subtle">
          <span className="font-semibold text-mk-sealed-fg">SHA-256</span>
          <span className="truncate font-mono">4f2a…c81d</span>
        </p>
      </div>
    </Panel>
  );
}

/** Templates — FEATURES.md §3. A library with a shared catalogue import. */
export function TemplatesMock() {
  const templates = [
    { name: 'Master services agreement', used: '24 sent' },
    { name: 'Residential lease', used: '11 sent' },
    { name: 'Contractor agreement', used: '8 sent' },
  ];
  return (
    <Panel title="Templates" action="New">
      <div className="flex h-full flex-col">
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {templates.map(template => (
            <li
              key={template.name}
              className="flex items-center gap-3 rounded-mk-card border border-mk-hairline px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="grid h-7 w-7 shrink-0 place-items-center rounded bg-mk-action-subtle text-[11px] font-bold text-mk-action-fg"
              >
                T
              </span>
              <span className="min-w-0 flex-1 truncate text-mk-copy-sm font-semibold text-mk-ink">
                {template.name}
              </span>
              <span className="shrink-0 text-[11px] text-mk-ink-subtle">{template.used}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto rounded-mk-card border border-dashed border-mk-action bg-mk-action-subtle px-3 py-2.5">
          <p className="m-0 text-mk-copy-sm font-semibold text-mk-action-fg">
            Import from the shared catalogue
          </p>
          <p className="m-0 text-[11px] text-mk-action-fg">
            Standard forms your organisation publishes centrally
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Branding — FEATURES.md §11. A theme with the signing page it produces. */
export function BrandingMock() {
  return (
    <Panel title="Brand theme" action="Live">
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-lg bg-mk-action text-mk-copy-sm font-bold text-mk-action-ink"
          >
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-mk-copy-sm font-bold text-mk-ink">Acme Property</span>
            <span className="block text-[11px] text-mk-ink-subtle">Logo and accent colour</span>
          </span>
        </div>

        <div className="flex gap-1.5">
          {['bg-mk-action', 'bg-mk-sealed', 'bg-mk-ink', 'bg-mk-canvas-sunken'].map(swatch => (
            <span
              key={swatch}
              aria-hidden="true"
              className={cx('h-6 w-6 rounded border border-mk-hairline', swatch)}
            />
          ))}
        </div>

        <div className="mt-auto rounded-mk-card border border-mk-hairline p-3">
          <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-mk-ink-subtle">
            What your signer sees
          </p>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-5 w-5 rounded bg-mk-action" />
            <Line w="55%" />
          </div>
          <span className="mt-2 block h-6 w-24 rounded-mk-chip bg-mk-action" aria-hidden="true" />
        </div>
      </div>
    </Panel>
  );
}

/** Developer platform — FEATURES.md §14. Keys, scopes and webhook deliveries. */
export function ApiMock() {
  return (
    <Panel title="API keys" action="New key">
      <div className="flex h-full flex-col">
        <div className="mb-3 rounded-mk-card border border-mk-hairline p-3">
          <p className="m-0 mb-1 flex items-center justify-between text-mk-copy-sm font-semibold text-mk-ink">
            Production
            <Status label="Active" tone="sealed" />
          </p>
          <p className="m-0 truncate font-mono text-[11px] text-mk-ink-subtle">sk_live_••••••••4a91</p>
          <p className="m-0 mt-2 flex gap-1.5">
            {['documents:write', 'webhooks:read'].map(scope => (
              <span
                key={scope}
                className="rounded-mk-chip bg-mk-action-subtle px-2 py-0.5 text-[10px] font-semibold text-mk-action-fg"
              >
                {scope}
              </span>
            ))}
          </p>
        </div>

        <p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mk-ink-subtle">
          Recent deliveries
        </p>
        <div className="mt-auto">
          <Row value="200" strong>
            document.completed
          </Row>
          <Row value="200" strong>
            payment.succeeded
          </Row>
          <Row value="200" strong>
            recipient.signed
          </Row>
        </div>
      </div>
    </Panel>
  );
}

/** Field placement — FEATURES.md §4. The prepare screen. */
export function PrepareMock() {
  return (
    <Panel title="Place fields" action="Send">
      <div className="flex h-full gap-3">
        <div className="min-w-0 flex-1 rounded border border-mk-hairline p-3">
          <Line w="88%" className="mb-2" />
          <Line w="72%" className="mb-2" />
          <span className="my-2 block rounded border border-dashed border-mk-action bg-mk-action-subtle px-2 py-2 text-[11px] font-semibold text-mk-action-fg">
            Signature · Dana R.
          </span>
          <Line w="64%" className="mb-2" />
          <span className="my-2 block rounded border border-dashed border-mk-sealed bg-mk-sealed-subtle px-2 py-2 text-[11px] font-semibold text-mk-sealed-fg">
            Deposit · $1,500
          </span>
          <Line w="46%" />
        </div>
        <ul className="m-0 hidden w-24 shrink-0 list-none flex-col gap-1.5 p-0 sm:flex">
          {['Signature', 'Initials', 'Date', 'Text', 'Payment'].map(field => (
            <li
              key={field}
              className="rounded border border-mk-hairline px-2 py-1.5 text-[11px] font-semibold text-mk-ink-muted"
            >
              {field}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** The signer's phone view — FEATURES.md §6. Consent, sign, pay. */
export function SigningMock() {
  return (
    <div className="flex aspect-[9/16] flex-col bg-mk-card p-4">
      <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-mk-ink-subtle">
        Acme Property
      </p>
      <p className="m-0 mb-3 text-mk-copy-md font-bold text-mk-ink">Residential lease</p>

      <div className="mb-3 rounded-mk-card border border-mk-hairline p-3">
        <Line w="100%" className="mb-2" />
        <Line w="82%" className="mb-2" />
        <Line w="90%" />
      </div>

      <p className="m-0 mb-3 rounded-mk-card border border-dashed border-mk-action bg-mk-action-subtle px-3 py-4 text-center text-mk-copy-lg text-mk-action-fg">
        <span style={{ fontFamily: 'var(--font-caveat), cursive' }}>Dana Reyes</span>
      </p>

      <div className="mb-3 flex items-center justify-between rounded-mk-card border border-mk-sealed-border bg-mk-sealed-subtle px-3 py-2.5">
        <span className="text-mk-copy-sm text-mk-sealed-fg">Deposit</span>
        <strong className="text-mk-copy-md text-mk-sealed-fg" data-sf-num>
          $1,500.00
        </strong>
      </div>

      <span
        aria-hidden="true"
        className="mt-auto grid min-h-[40px] place-items-center rounded-mk-chip bg-mk-sealed text-mk-copy-sm font-bold text-white"
      >
        Pay and finish
      </span>
    </div>
  );
}
