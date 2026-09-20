# The marketing kit

Everything under `app/(marketing)/` is built from these components. The rules
below are what keep thirty pages looking like one site.

## The contract

1. **Import from `@/components/marketing`**, never from the individual files.
2. **Never write a raw colour, size or spacing value.** Use the `mk-` utilities
   (`bg-mk-canvas`, `text-mk-display-lg`, `py-mk-section`). They resolve against
   `app/marketing-tokens.css`, which is scoped to `[data-surface="marketing"]`
   and set once by the marketing layout.
3. **No `style={{…}}`.** The app does this 1,100 times and it is why the app
   cannot be themed; the marketing site starts clean. The one exception is a
   computed width on a decorative bar.
4. **One `variant="solid"` CTA per section.** Everything else is `outline`,
   `ghost` or `on-dark`.
5. **Tailwind preflight is off.** Browser default margins still apply, so every
   heading, paragraph and list you write needs `m-0` / `p-0` explicitly. The kit
   components already do.
6. **Claims must be true.** Every statement on a marketing page has to name
   something the product does today. Put the `FEATURES.md` section in a comment
   beside the copy, as `lib/marketing/content.ts` does.
7. **Never retype a price.** Pricing comes from `GET /api/billing/plans` through
   `PricingCards`. If the call fails, render nothing.

## Page skeleton

```tsx
import { Hero, FeatureBlock, Faq, CtaBand, Cta, CtaRow } from '@/components/marketing';

export const metadata = { title: '…', description: '…' };

export default function Page() {
  return (
    <>
      <Hero title="…" lead="…" actions={<CtaRow><Cta href="/register">Start free</Cta></CtaRow>} />
      <FeatureBlock title="…" body="…" art={…} />
      <Faq items={FAQ} />
      <CtaBand title="…" />
    </>
  );
}
```

The layout supplies `<main>`, the header and the footer. A page is only its own
bands.

## Components

| Component | Use |
|---|---|
| `Hero` | The dark opening band. `title`, `lead`, `actions`, optional `eyebrow`, `note`, `art`. |
| `Section` + `Container` | A generic band. `tone` is `canvas`, `alt` or `band`. |
| `SectionHeader` | Centred eyebrow + heading + lead. Use it for every non-hero section. |
| `FeatureBlock` | Alternating copy-and-image row. Set `reverse` on odd rows. |
| `Grid` + `Card` | Two, three or four up cards. |
| `StepList` | Numbered how-it-works row. |
| `ProofStrip` | Metrics and logos under the hero. Renders nothing when empty — leave it that way until the numbers are real. |
| `PricingCards` | The plan grid, from the API. |
| `CompareTable` | `/vs/*` matrix. At least one row must have `theirWin: true`. |
| `Faq` | Accordion plus `FAQPage` JSON-LD generated from the same array. |
| `CtaBand` | The closing band. No exit popups anywhere. |
| `CodeTabs` | The only client component. Developer page code samples. |
| `BrowserFrame` / `PhoneFrame` | Wrap product imagery. |
| `Cta` / `CtaRow` | Buttons. `size="lg"` in heroes and bands. |

## Type

`Display` sets the tag with `level` and the size with `size`, separately, so the
document outline stays correct while a second-section heading can still read
large. Headlines use the display serif; everything else is Geist.

## Accessibility

- Targets are at least 44px (`min-h-mk-cta`). WCAG 2.2 requires 24px.
- Sections that anchor from the nav need `scroll-mt-24`, because the header is
  sticky and 2.4.11 says focus must not be obscured.
- Dark bands set `data-sf-dark`, which switches the focus ring to a light one.
- Contrast pairs are asserted in `test/marketing-tokens.test.ts`. Add a pair
  there if you introduce a new text-on-surface combination.
