/**
 * The changelog.
 *
 * A dated, versioned list built from `lib/marketing/changelog.ts`, which is
 * itself a human-readable rewrite of real commits. Newest release first, one
 * `<section>` per version, so a returning visitor can scan the last few
 * entries instead of scrolling a flat list.
 */
import type { Metadata } from 'next';
import { Container, Display, CtaBand } from '@/components/marketing';
import { CHANGELOG } from '@/lib/marketing/changelog';

export const metadata: Metadata = {
  title: 'Changelog — SignerPro',
  description: 'What shipped, release by release, straight from the commit history.',
};

export default function ChangelogPage() {
  return (
    <>
      <section
        data-sf-dark=""
        className="bg-mk-band bg-mk-glow px-mk-gutter py-mk-band text-mk-band-ink"
      >
        <Container width="prose">
          <Display level={1} size="lg" className="text-mk-band-ink">
            Changelog
          </Display>
          <p className="mt-mk-stack mb-0 max-w-mk-measure text-mk-copy-lg text-mk-band-ink-muted">
            Every release, in the order it shipped. No entry here describes a feature that
            is not actually in the app.
          </p>
        </Container>
      </section>

      <section className="bg-mk-canvas px-mk-gutter py-mk-section">
        <Container width="prose">
          <ol className="m-0 flex list-none flex-col gap-mk-stack-lg p-0">
            {CHANGELOG.map(release => (
              <li key={release.version}>
                <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-mk-hairline pb-3">
                  <h2 className="m-0 text-mk-copy-lg font-bold text-mk-ink">
                    v{release.version}
                  </h2>
                  <time dateTime={release.date} className="text-mk-copy-sm text-mk-ink-muted">
                    {new Date(release.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </time>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {release.entries.map(entry => (
                    <li
                      key={entry.summary}
                      className="text-mk-copy-md text-mk-ink-muted"
                    >
                      {entry.summary}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand
        title="See it for yourself"
        lead="Create a free workspace and try the release that just shipped."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
