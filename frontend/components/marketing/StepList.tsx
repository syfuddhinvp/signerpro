/** The numbered "how it works" row. */
import { Container, SectionHeader, Grid, Card } from './primitives';

export type Step = { title: string; body: string };

export default function StepList({
  steps,
  title,
  lead,
  id,
}: {
  steps: Step[];
  title: string;
  lead?: string;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 bg-mk-canvas px-mk-gutter py-mk-section">
      <Container>
        <SectionHeader title={title} lead={lead} size="md" />
        <ol className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-mk-card border border-mk-hairline bg-mk-card p-6">
              <span
                aria-hidden="true"
                className="mb-4 grid h-8 w-8 place-items-center rounded-full bg-mk-action text-mk-copy-sm font-bold text-mk-action-ink"
              >
                {index + 1}
              </span>
              <h3 className="m-0 mb-2 text-mk-copy-md font-bold text-mk-ink">{step.title}</h3>
              <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

export { Grid, Card };
