import type { Metadata } from 'next';
import Billing from '@/components/sf/screens/Billing';
import Invoices from '@/components/sf/screens/Invoices';
import { serverCaller } from '@/lib/api/client';
import { billing as billingApi, organizations as organizationsApi } from '@/lib/api/resources';
import { toInvoiceRows } from '@/lib/sf/adapters';
import type {
  BillingSettingsResponse,
  ChargeResponse,
  PaymentMethodResponse,
  InvoiceResponse,
  SubscriptionResponse,
  UpcomingInvoiceResponse,
  Wallet,
} from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Billing & plan · Account · SignerPro' };

/* A workspace that has never checked out still has to render the screen, so
   every call gets a shape-complete fallback rather than throwing. */
const FALLBACK_SUB: SubscriptionResponse = {
  id: null,
  organization_id: '',
  plan_code: '',
  plan_name: '—',
  status: 'inactive',
  current_period_start: null,
  current_period_end: null,
  trial_ends_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  provider: null,
  entitlements: {},
  seats_licensed: 0,
  seats_activated: 0,
  seat_price_cents: 0,
  is_seat_based: false,
  cycle: 'monthly',
  next_invoice_total_cents: 0,
  next_invoice_at: null,
  has_provider_subscription: false,
  pending_plan_code: null,
  pending_plan_name: null,
  pending_plan_effective_at: null,
};

const FALLBACK_SETTINGS: BillingSettingsResponse = {
  organization_id: '',
  autopay: false,
  billing_email: null,
  tax_id: null,
  cycle: 'monthly',
  default_payment_method_id: null,
  po_number: null,
  currency: 'USD',
};

const FALLBACK_UPCOMING: UpcomingInvoiceResponse = {
  organization_id: '',
  plan_code: '',
  plan_name: '—',
  cycle: 'monthly',
  seats_licensed: 0,
  period_start: null,
  period_end: null,
  currency: 'USD',
  line_items: [],
  subtotal_cents: 0,
  tax_cents: 0,
  total_cents: 0,
  due_at: null,
};

/** The invoice list's four chips; anything else in the URL falls back to `all`. */
const FILTERS = ['all', 'open', 'paid', 'past_due'];

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = status && FILTERS.indexOf(status) > -1 ? status : 'all';
  const api = serverCaller('/account/billing');

  const [subResult, settingsResult, pmResult, upcomingResult, chargesResult, invoiceResult, orgResult, walletResult] = await Promise.all([
    billingApi.subscription(api),
    billingApi.settings(api),
    billingApi.paymentMethods(api),
    billingApi.upcomingInvoice(api),
    billingApi.charges(api, { limit: 4 }),
    /* `scope` is not on `invoices.list`'s param type, so the caller is used
       directly rather than editing the shared resource module. */
    api<InvoiceResponse[]>('/api/invoices', {
      query: { status: filter === 'all' ? undefined : filter, scope: 'organization' },
    }),
    organizationsApi.me(api),
    billingApi.wallet(api, { limit: 10 }),
  ]);

  const paymentMethods: PaymentMethodResponse[] = pmResult.ok ? pmResult.data : [];
  const charges: ChargeResponse[] = chargesResult.ok ? chargesResult.data : [];
  /* A workspace that has never held balance still renders: an empty wallet is
     the correct answer, not an error. */
  const wallet: Wallet = walletResult.ok
    ? walletResult.data
    : { balance_cents: 0, currency: 'USD', withdrawable: false, total: 0, entries: [] };

  return (
    <>
      {!subResult.ok || !settingsResult.ok || !upcomingResult.ok || !pmResult.ok || !chargesResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your billing account" detail={(subResult.ok ? null : subResult.error.message) ?? (settingsResult.ok ? null : settingsResult.error.message) ?? (upcomingResult.ok ? null : upcomingResult.error.message) ?? (pmResult.ok ? null : pmResult.error.message) ?? (chargesResult.ok ? null : chargesResult.error.message)} />
        </div>
      ) : null}
      <Billing
        subscription={subResult.ok ? subResult.data : FALLBACK_SUB}
        settings={settingsResult.ok ? settingsResult.data : FALLBACK_SETTINGS}
        paymentMethods={paymentMethods}
        upcoming={upcomingResult.ok ? upcomingResult.data : FALLBACK_UPCOMING}
        charges={charges}
        wallet={wallet}
      />
      {!invoiceResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your invoices" detail={invoiceResult.error.message} />
        </div>
      ) : null}
      <Invoices
        rows={toInvoiceRows(invoiceResult.ok ? invoiceResult.data : [])}
        filter={filter}
        platform={false}
        scopeName={orgResult.ok ? orgResult.data.name : 'Your workspace'}
      />
    </>
  );
}
