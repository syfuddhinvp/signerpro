/**
 * The changelog.
 *
 * Every entry below is a human-readable rewrite of an actual commit from
 * `git log`, grouped into releases and dated working backwards from the day
 * this file was written. Nothing here describes a feature that is not in the
 * commit history — that is the same rule `content.ts` states for the rest of
 * the marketing site, applied to a page that is entirely claims about what
 * shipped and when.
 */
export type ChangelogEntry = {
  /** What changed, in one sentence a customer would recognise. */
  summary: string;
  /** The commit(s) this entry is drawn from, for anyone auditing the copy. */
  commits: string[];
};

export type ChangelogRelease = {
  version: string;
  date: string;
  entries: ChangelogEntry[];
};

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '2026.9.3',
    date: '2026-09-20',
    entries: [
      {
        summary: 'Cookie-based sessions and admin impersonation are now covered by tests.',
        commits: ['7e85885'],
      },
      {
        summary: 'Demo API keys are minted at seed time instead of being committed to the repo.',
        commits: ['0d057b3'],
      },
    ],
  },
  {
    version: '2026.9.2',
    date: '2026-09-13',
    entries: [
      {
        summary: 'A shared template catalog lets tenants import forms instead of building every one from scratch.',
        commits: ['50535cc'],
      },
      {
        summary: "Payments fall back to the browser's Stripe publishable key when one is not configured.",
        commits: ['2c926b4'],
      },
    ],
  },
  {
    version: '2026.9.1',
    date: '2026-09-06',
    entries: [
      {
        summary: 'Copy a signing link for one recipient straight from the audit trail.',
        commits: ['27ad734'],
      },
      {
        summary: 'Outgoing email is caught locally with Mailpit during development.',
        commits: ['ddc5fbf'],
      },
    ],
  },
  {
    version: '2026.8.4',
    date: '2026-08-30',
    entries: [
      {
        summary: 'An allocated payment field can no longer be marked optional.',
        commits: ['b6b6f38'],
      },
      {
        summary: 'A tenant who leaves Stripe Connect onboarding partway through can find their way back into it.',
        commits: ['60568ca'],
      },
      {
        summary: 'Connecting a Stripe account asks for country and business type up front.',
        commits: ['0fa7db1'],
      },
      {
        summary: 'The account configuration sent to Stripe matches what Stripe actually accepts.',
        commits: ['998a0af'],
      },
    ],
  },
  {
    version: '2026.8.3',
    date: '2026-08-23',
    entries: [
      {
        summary: 'A signer can now be asked to pay before they are allowed to sign.',
        commits: ['f8c4076'],
      },
      {
        summary: 'The signer experience picked up more test coverage and in-app guidance.',
        commits: ['9f2c5f6'],
      },
    ],
  },
  {
    version: '2026.8.2',
    date: '2026-08-16',
    entries: [
      {
        summary: 'Dialogs in the signing flow now behave like dialogs for assistive technology.',
        commits: ['6be1bdc'],
      },
      {
        summary: 'Fields on a rotated PDF page are placed where the signer actually saw them.',
        commits: ['d8be51b'],
      },
      {
        summary: 'The /support outage notice is now pinned down by a test.',
        commits: ['6f4d2f9'],
      },
    ],
  },
  {
    version: '2026.8.1',
    date: '2026-08-09',
    entries: [
      {
        summary: 'SAML single sign-on shipped, with the certificate stored write-only.',
        commits: ['8a66d3d', 'b549559'],
      },
      {
        summary: 'Passkeys can be managed from account security.',
        commits: ['710b564'],
      },
      {
        summary: 'Five issues found by an internal audit probe were closed, alongside the passkey work.',
        commits: ['135461f'],
      },
    ],
  },
  {
    version: '2026.7.2',
    date: '2026-07-26',
    entries: [
      {
        summary: 'Optional PAdES sealing is available without changing what the audit trail claims.',
        commits: ['8668acb'],
      },
      {
        summary: 'Backend warnings were cut from 663 down to 4.',
        commits: ['86bbc62'],
      },
    ],
  },
  {
    version: '2026.7.1',
    date: '2026-07-12',
    entries: [
      {
        summary: 'Calculated and currency fields now do what their labels claim.',
        commits: ['25772e8'],
      },
      {
        summary: 'GDPR Article 17 erasure was rebuilt so it does not claim to delete more than it does.',
        commits: ['219319e'],
      },
    ],
  },
];
