/**
 * The closing band.
 *
 * An inline band rather than an exit-intent modal on purpose: exit popups
 * convert worst of any vertical in B2B (about 2%), while a repeated closing
 * call to action is in every landing-page formula the research covers. One
 * action, no second option, no form.
 */
import type { ReactNode } from 'react';
import { Container, Display } from './primitives';
import { Cta, CtaRow } from './Cta';

export default function CtaBand({
  title,
  lead,
  href = '/register',
  label = 'Start free',
  secondary,
  note,
}: {
  title: ReactNode;
  lead?: ReactNode;
  href?: string;
  label?: string;
  secondary?: { href: string; label: string };
  note?: ReactNode;
}) {
  return (
    <section
      data-sf-dark=""
      className="bg-mk-band bg-mk-glow-sealed px-mk-gutter py-mk-band text-center text-mk-band-ink"
    >
      <Container width="prose">
        <Display level={2} size="lg" className="text-mk-band-ink">
          {title}
        </Display>
        {lead ? (
          <p className="mx-auto mt-mk-stack mb-mk-stack-lg max-w-mk-measure text-mk-copy-lg text-mk-band-ink-muted">
            {lead}
          </p>
        ) : null}
        <CtaRow center>
          <Cta href={href} size="lg">
            {label}
          </Cta>
          {secondary ? (
            <Cta href={secondary.href} variant="on-dark" size="lg">
              {secondary.label}
            </Cta>
          ) : null}
        </CtaRow>
        {note ? (
          <p className="mt-5 mb-0 text-mk-copy-sm text-mk-band-ink-muted">{note}</p>
        ) : null}
      </Container>
    </section>
  );
}
