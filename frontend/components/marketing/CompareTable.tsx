/**
 * The comparison matrix used by every `/vs/<competitor>` page.
 *
 * The honesty rule from `MARKETING_PLAN.md` section 9 is enforced by the data
 * shape rather than by good intentions: a row's `them` value is free text, not
 * a boolean, so a competitor's genuine advantage can be stated plainly, and
 * `ComparisonPage` requires at least one `theirWin` row before it will render.
 * A matrix where the other product never wins is one a reader stops believing
 * at the third row.
 *
 * Marked up as a real `<table>` with a row header column, so the comparison is
 * navigable by a screen reader rather than a grid of icons.
 */
import { Container } from './primitives';
import { cx } from './primitives';

export type CompareRow = {
  feature: string;
  us: string;
  them: string;
  /** Set when the competitor is genuinely better on this row. */
  theirWin?: boolean;
  note?: string;
};

export default function CompareTable({
  rows,
  competitor,
  caption,
}: {
  rows: CompareRow[];
  competitor: string;
  caption?: string;
}) {
  return (
    <section className="bg-mk-canvas px-mk-gutter py-mk-section">
      <Container>
        <div className="overflow-x-auto rounded-mk-card border border-mk-hairline">
          <table className="w-full border-collapse bg-mk-card text-left">
            {caption ? (
              <caption className="px-5 py-4 text-left text-mk-copy-sm text-mk-ink-muted">
                {caption}
              </caption>
            ) : null}
            <thead>
              <tr className="border-b border-mk-hairline bg-mk-canvas-alt">
                <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                  Feature
                </th>
                <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-action-fg">
                  SignerPro
                </th>
                <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                  {competitor}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.feature} className="border-b border-mk-hairline last:border-b-0">
                  <th
                    scope="row"
                    className="px-5 py-3 align-top text-mk-copy-sm font-semibold text-mk-ink"
                  >
                    {row.feature}
                    {row.note ? (
                      <span className="mt-1 block font-normal text-mk-copy-xs text-mk-ink-subtle">
                        {row.note}
                      </span>
                    ) : null}
                  </th>
                  <td
                    className={cx(
                      'px-5 py-3 align-top text-mk-copy-sm',
                      row.theirWin ? 'text-mk-ink-muted' : 'font-semibold text-mk-sealed-fg',
                    )}
                  >
                    {row.us}
                  </td>
                  <td
                    className={cx(
                      'px-5 py-3 align-top text-mk-copy-sm',
                      row.theirWin ? 'font-semibold text-mk-ink' : 'text-mk-ink-muted',
                    )}
                  >
                    {row.them}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
