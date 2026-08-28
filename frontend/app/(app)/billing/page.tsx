import type { Metadata } from 'next';
import Billing from '@/components/sf/screens/Billing';
import { serverCaller } from '@/lib/api/client';
import { billing as billingApi } from '@/lib/api/resources';
import type {
  BillingSettingsResponse,
  ChargeResponse,
  PaymentMethodResponse,
  SubscriptionResponse,
  UpcomingInvoiceResponse,
} from '@/lib/api/types';

export const metadata: Metadata = { title: 'Billing · SignForge' };

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

export default async function Page() {
  const api = serverCaller('/billing');

  const [subResult, settingsResult, pmResult, upcomingResult, chargesResult] = await Promise.all([
    billingApi.subscription(api),
    billingApi.settings(api),
    billingApi.paymentMethods(api),
    billingApi.upcomingInvoice(api),
    billingApi.charges(api, { limit: 4 }),
  ]);

  const paymentMethods: PaymentMethodResponse[] = pmResult.ok ? pmResult.data : [];
  const charges: ChargeResponse[] = chargesResult.ok ? chargesResult.data : [];

  return (
    <Billing
      subscription={subResult.ok ? subResult.data : FALLBACK_SUB}
      settings={settingsResult.ok ? settingsResult.data : FALLBACK_SETTINGS}
      paymentMethods={paymentMethods}
      upcoming={upcomingResult.ok ? upcomingResult.data : FALLBACK_UPCOMING}
      charges={charges}
    />
  );
}
