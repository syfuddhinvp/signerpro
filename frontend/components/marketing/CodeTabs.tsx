'use client';

/**
 * Tabbed code samples for the developer page.
 *
 * The one client component on the marketing site. It earns that because the
 * research is unambiguous: the challengers that win developer attention put
 * runnable code on the marketing page itself, and a language switcher is the
 * difference between a sample and a wall of curl.
 *
 * Implemented as a real tab list — roving `tabindex`, arrow-key navigation,
 * `aria-selected`, panels wired with `aria-labelledby` — because a set of
 * buttons that swap a `<pre>` is not navigable otherwise.
 */
import { useId, useRef, useState } from 'react';

export type CodeSample = { label: string; language: string; code: string };

export default function CodeTabs({ samples }: { samples: CodeSample[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Left/right move selection; Home/End jump to the ends. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = samples.length - 1;
    let next = active;
    if (event.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (event.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="overflow-hidden rounded-mk-card border border-mk-hairline bg-mk-band">
      <div
        role="tablist"
        aria-label="Code samples"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 border-b border-mk-band-hairline/15 bg-mk-band-raised px-2 py-2"
      >
        {samples.map((sample, index) => {
          const selected = index === active;
          return (
            <button
              key={sample.label}
              ref={element => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={
                'min-h-mk-cta rounded-mk-chip px-4 text-mk-copy-sm font-semibold transition-colors ' +
                (selected
                  ? 'bg-mk-action text-mk-action-ink'
                  : 'text-mk-band-ink-muted hover:text-mk-band-ink')
              }
            >
              {sample.label}
            </button>
          );
        })}
      </div>

      {samples.map((sample, index) => (
        <div
          key={sample.label}
          role="tabpanel"
          id={`${base}-panel-${index}`}
          aria-labelledby={`${base}-tab-${index}`}
          hidden={index !== active}
          tabIndex={0}
        >
          <pre className="m-0 overflow-x-auto p-5 text-mk-copy-xs leading-relaxed text-mk-band-ink">
            <code className={`language-${sample.language}`}>{sample.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
