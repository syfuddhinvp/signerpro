/**
 * The feature comparison matrix on `/pricing`.
 *
 * A real `<table>`, not a grid of cards pretending to be one: a screen reader
 * user should be able to move by row and column and hear which plan has which
 * feature, which a `<div>` grid cannot give them. Rows are grouped into a
 * `<tbody>` per category so the table reads as sections rather than one long
 * list, and every value names something the product does today — the same
 * rule `content.ts` states for prose.
 */
import { Container, SectionHeader } from './primitives';

export type MatrixCell = boolean | string;

export type MatrixRow = {
  feature: string;
  values: MatrixCell[];
};

export type MatrixCategory = {
  category: string;
  rows: MatrixRow[];
};

function Cell({ value }: { value: MatrixCell }) {
  if (value === true) {
    return (
      <span aria-hidden className="text-mk-sealed-fg">
        ✓
      </span>
    );
  }
  if (value === false) {
    return (
      <span aria-hidden className="text-mk-ink-muted">
        —
      </span>
    );
  }
  return <span>{value}</span>;
}

export default function PlanMatrix({
  planNames,
  categories,
  title,
  lead,
  id = 'compare',
}: {
  planNames: string[];
  categories: MatrixCategory[];
  title: string;
  lead?: string;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 bg-mk-canvas-alt px-mk-gutter py-mk-section">
      <Container width="wide">
        <SectionHeader title={title} lead={lead} size="md" />
        <div className="overflow-x-auto rounded-mk-card border border-mk-hairline bg-mk-card">
          <table className="w-full min-w-[640px] border-collapse text-left text-mk-copy-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-mk-hairline p-4 font-semibold text-mk-ink">
                  Feature
                </th>
                {planNames.map(name => (
                  <th
                    key={name}
                    scope="col"
                    className="border-b border-mk-hairline p-4 text-center font-semibold text-mk-ink"
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            {categories.map(group => (
              <tbody key={group.category}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={planNames.length + 1}
                    className="border-b border-mk-hairline bg-mk-canvas-alt p-3 text-mk-copy-xs font-semibold uppercase text-mk-ink-muted"
                  >
                    {group.category}
                  </th>
                </tr>
                {group.rows.map(row => (
                  <tr key={row.feature}>
                    <th
                      scope="row"
                      className="border-b border-mk-hairline p-4 font-normal text-mk-ink"
                    >
                      {row.feature}
                    </th>
                    {row.values.map((value, index) => (
                      <td
                        key={planNames[index]}
                        className="border-b border-mk-hairline p-4 text-center text-mk-ink-muted"
                      >
                        <Cell value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Container>
    </section>
  );
}
