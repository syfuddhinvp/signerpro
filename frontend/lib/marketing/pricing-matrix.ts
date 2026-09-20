/**
 * The feature comparison matrix on `/pricing`.
 *
 * Unlike the plan grid, this table does not read prices, so it is safe to
 * keep as a literal array: every value below names something the product
 * does today, with its `FEATURES.md` section noted beside the group. It does
 * not name which paid tier gets which row, because the catalogue decides
 * that and this file cannot see it — every row applies to every paid plan,
 * and the free row says what free actually includes.
 */
import type { MatrixCategory } from '@/components/marketing';

/** Column headers. Kept short: the plan names already carry the detail. */
export const MATRIX_PLANS = ['Free', 'Paid plans'];

export const MATRIX: MatrixCategory[] = [
  {
    // FEATURES.md §5, §4 — routing, templates.
    category: 'Sending',
    rows: [
      { feature: 'Upload a PDF and place fields', values: [true, true] },
      { feature: 'Reusable templates', values: [true, true] },
      { feature: 'Sequential and parallel routing', values: [true, true] },
      { feature: 'Signers, approvers and CC recipients', values: [true, true] },
    ],
  },
  {
    // FEATURES.md §8 — audit log, certificate, verify page.
    category: 'Proof',
    rows: [
      { feature: 'Audit trail on every document', values: [true, true] },
      { feature: 'Audit certificate appended to the sealed PDF', values: [true, true] },
      { feature: 'Public verification link, no account needed', values: [true, true] },
    ],
  },
  {
    // FEATURES.md §7 — Stripe Connect, splits, refunds.
    category: 'Payments',
    rows: [
      { feature: 'Collect payment in the signing session', values: [false, true] },
      { feature: 'Split a fee across recipients', values: [false, true] },
      { feature: 'Refund from the payments view', values: [false, true] },
    ],
  },
  {
    // FEATURES.md §14, §15 — API, webhooks, embedding.
    category: 'Developer platform',
    rows: [
      { feature: 'API keys with scopes and a sandbox', values: [true, true] },
      { feature: 'Webhooks with a delivery log and replay', values: [false, true] },
      { feature: 'Embedded signing with revocable session tokens', values: [false, true] },
    ],
  },
  {
    // FEATURES.md §1, §11 — SSO, branding.
    category: 'Team and branding',
    rows: [
      { feature: 'Your logo and colour on the signing page', values: [false, true] },
      { feature: 'SAML single sign-on and SCIM provisioning', values: [false, true] },
      { feature: 'Passkeys for your team', values: [true, true] },
    ],
  },
];
