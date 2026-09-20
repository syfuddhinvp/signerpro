/**
 * The marketing site's map.
 *
 * One source of truth for the header, the footer and the sitemap. The footer
 * is where the acquisition pages in `MARKETING_PLAN.md` section 4 tier 2 are
 * linked from, which is what makes them crawlable at all — a page nothing
 * links to is a page nothing indexes.
 */

/** The marketing pages run pre-authentication, so there is no tenant accent to
 *  read; the mark uses the product's own indigo. */
export const BRAND_ACCENT = '#4f46e5';

export const MARKETING_NAV: { href: string; label: string }[] = [
  { href: '/product/payments', label: 'Payments' },
  { href: '/solutions/real-estate', label: 'Solutions' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/developers', label: 'Developers' },
  { href: '/trust', label: 'Trust' },
];

export type FooterColumn = { title: string; links: { href: string; label: string }[] };

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/product/payments', label: 'Payments at signing' },
      { href: '/product/routing', label: 'Routing' },
      { href: '/product/audit-trail', label: 'Audit trail' },
      { href: '/product/templates', label: 'Templates' },
      { href: '/product/signing', label: 'The signer experience' },
      { href: '/product/branding', label: 'Branding' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Compare',
    links: [
      { href: '/vs/docusign', label: 'vs DocuSign' },
      { href: '/vs/dropbox-sign', label: 'vs Dropbox Sign' },
      { href: '/vs/pandadoc', label: 'vs PandaDoc' },
      { href: '/vs/signnow', label: 'vs signNow' },
      { href: '/vs/adobe-acrobat-sign', label: 'vs Adobe Acrobat Sign' },
      { href: '/alternatives/docusign', label: 'DocuSign alternatives' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { href: '/solutions/real-estate', label: 'Real estate' },
      { href: '/solutions/mortgage', label: 'Mortgage' },
      { href: '/solutions/property-management', label: 'Property management' },
      { href: '/solutions/professional-services', label: 'Professional services' },
      { href: '/solutions/hr', label: 'HR and onboarding' },
      { href: '/templates', label: 'Templates' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/developers', label: 'API and embedding' },
      { href: '/developers#webhooks', label: 'Webhooks' },
      { href: '/developers#sandbox', label: 'Sandbox' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/trust', label: 'Trust center' },
      { href: '/security', label: 'Security' },
      { href: '/legality', label: 'E-signature legality' },
      { href: '/verify', label: 'Verify a document' },
    ],
  },
];
