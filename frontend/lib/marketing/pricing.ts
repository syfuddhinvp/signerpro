/**
 * Pricing copy derived from the catalogue, not typed beside it.
 *
 * The page used to assert "Priced per seat, not per signature" in a string
 * literal while the catalogue served flat per-workspace plans with a monthly
 * document cap. Both were rendered on the same screen, so a visitor who read
 * the heading and then the cards was told two different things.
 *
 * The heading is now a function of what the API actually returns. If the
 * catalogue is later restructured — `MARKETING_PLAN.md` section 3 proposes
 * exactly that — the sentence follows it without anyone remembering to edit
 * this file.
 */
import type { PlanChoice } from '@/lib/sf/adapters';
import type { PlanResponse } from '@/lib/api/types';

export type PricingCopy = { title: string; lead: string };

/**
 * `plans` is the raw API rows; `choices` the adapted view. The raw rows are
 * needed because `is_seat_based` is what decides the sentence and the adapter
 * folds it into a label.
 */
export function pricingCopy(plans: PlanResponse[]): PricingCopy {
  const paid = plans.filter(plan => (plan.seat_price_cents ?? plan.price_cents) > 0);
  const anySeatBased = paid.some(plan => plan.is_seat_based);
  const allSeatBased = paid.length > 0 && paid.every(plan => plan.is_seat_based);

  if (allSeatBased) {
    return {
      title: 'Priced per seat, not per signature',
      lead: 'You pay for the people who send documents. The people who sign them never pay anything.',
    };
  }
  if (anySeatBased) {
    return {
      title: 'Pay for senders, not for signatures',
      lead: 'Some plans are priced per seat and some per workspace. Either way, the people who sign your documents never pay anything.',
    };
  }
  return {
    title: 'One price per workspace',
    lead: 'A flat monthly price for the whole team. The people who sign your documents never pay anything.',
  };
}

/** The plan a pricing grid should highlight: the middle paid tier. */
export function featuredIndex(choices: PlanChoice[]): number {
  const paid = choices.filter(choice => choice.priceCents > 0);
  if (paid.length === 0) return -1;
  const middle = paid[Math.floor((paid.length - 1) / 2)];
  return choices.indexOf(middle);
}
