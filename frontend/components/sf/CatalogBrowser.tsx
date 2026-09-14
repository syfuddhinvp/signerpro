'use client';

/**
 * Browse the platform's form catalog and add one to this organization's
 * templates.
 *
 * A catalog entry is a blueprint owned by the platform, not a template this
 * organization owns. "Add to my templates" imports it — the server stamps out
 * a real template, and from that point it is an ordinary template: editable,
 * usable, archivable, and untouched if the platform later retires the entry.
 * That is why this screen adds rather than sends: the sender still assigns
 * real signers before anything goes out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { catalog as catalogApi } from '@/lib/api/resources';
import type { CatalogCategory, CatalogTemplateResponse } from '@/lib/api/types';
import { useSF } from '@/lib/sf/state';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';
import { btn, inputStyle, linkBtn, TEXT_MUTED } from '@/lib/sf/ui';

const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  government: 'Government',
  legal: 'Legal',
  hr: 'HR',
  finance: 'Finance',
  real_estate: 'Real estate',
  health: 'Health',
  other: 'Other',
};

function categoryLabel(key: string): string {
  return CATEGORY_LABEL[key as CatalogCategory] ?? key;
}

export default function CatalogBrowser({ onClose }: { onClose: () => void }) {
  const { flash, accent } = useSF();
  const router = useRouter();
  const A = accent();
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useModalBehaviour<HTMLDivElement>(true, close);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<CatalogTemplateResponse[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Ids mid-import, so a double click cannot import the same form twice. */
  const [importing, setImporting] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* A slow response for a query the user has already replaced must not
     overwrite the results for the query they are actually looking at. */
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    void catalogApi
      .browse(apiCall, { q: debounced || undefined, category: category || undefined, limit: 100 })
      .then(res => {
        if (id !== requestId.current) return;
        setLoading(false);
        if (!res.ok) { setError(res.error.message); return; }
        setError(null);
        setItems(res.data.items);
        // Only refresh the filter options from an unfiltered result: a
        // category filter narrows `categories` to the one that is selected,
        // which would otherwise delete every other option from the control.
        if (!category) setCategories(res.data.categories);
      });
  }, [debounced, category]);

  useEffect(load, [load]);

  const add = useCallback((entry: CatalogTemplateResponse) => {
    if (importing.includes(entry.id)) return;
    setImporting(prev => [...prev, entry.id]);
    void catalogApi.import(apiCall, entry.id).then(res => {
      setImporting(prev => prev.filter(id => id !== entry.id));
      if (!res.ok) { flash('Could not add ' + entry.title + ' · ' + res.error.message); return; }
      flash(entry.title + ' added to your templates');
      setItems(prev => prev.map(item => (item.id === entry.id ? { ...item, imported: true } : item)));
      // The template list behind this dialog is server-rendered.
      router.refresh();
    });
  }, [flash, importing, router]);

  const empty = !loading && items.length === 0;
  const heading = useMemo(
    () => (debounced || category ? 'No forms match those filters' : 'The form catalog is empty'),
    [debounced, category],
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
        style={{
          background: '#fff', borderRadius: '16px', border: '1px solid #e3e7ee',
          width: 'min(820px, 100%)', maxHeight: 'min(86vh, 900px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #eef1f6', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
            <h2 id="catalog-title" style={{ margin: 0, fontSize: '.9375rem', fontWeight: 600, color: '#0f172a' }}>
              Form catalog
            </h2>
            <p style={{ margin: 0, fontSize: '.75rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
              Ready-made forms with their signature fields already placed. Adding one copies it into your
              templates — you assign signers before anything is sent.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close the form catalog" style={linkBtn('#64748b')}>Close</button>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid #eef1f6', display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 220px', minWidth: '180px' }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Search the form catalog
            </span>
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search forms, e.g. W-9 or IRS"
              style={inputStyle}
            />
          </label>
          <select
            value={category}
            onChange={event => setCategory(event.target.value)}
            aria-label="Filter the catalog by category"
            style={{ ...inputStyle, width: 'auto', minWidth: '150px' }}
          >
            <option value="">All categories</option>
            {categories.map(key => (
              <option key={key} value={key}>{categoryLabel(key)}</option>
            ))}
          </select>
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {error ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '.8125rem', fontWeight: 600, color: '#0f172a' }}>The catalog could not be loaded</span>
              <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{error}</span>
              <div><button type="button" onClick={load} style={btn('#fff', '#475569', '#e3e7ee')}>Try again</button></div>
            </div>
          ) : null}

          {loading && items.length === 0 && !error ? (
            <p style={{ margin: 0, padding: '20px 0', textAlign: 'center', fontSize: '.75rem', color: TEXT_MUTED }}>
              Loading forms…
            </p>
          ) : null}

          {empty && !error ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '.8125rem', fontWeight: 600, color: '#0f172a' }}>{heading}</span>
              <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
                Your administrator publishes the forms that appear here.
              </span>
            </div>
          ) : null}

          {items.map(entry => {
            const busy = importing.includes(entry.id);
            return (
              <div
                key={entry.id}
                style={{
                  border: '1px solid #e3e7ee', borderRadius: '13px', padding: '12px 13px',
                  display: 'flex', gap: '12px', alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <span style={{ fontSize: '.8125rem', fontWeight: 600, color: '#0f172a' }}>{entry.title}</span>
                  {entry.description ? (
                    <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
                      {entry.description}
                    </span>
                  ) : null}
                  <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>
                    {[
                      categoryLabel(entry.category),
                      entry.authority,
                      entry.jurisdiction,
                      entry.role_count === 1 ? '1 signer' : entry.role_count + ' signers',
                      entry.field_count === 1 ? '1 field' : entry.field_count + ' fields',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {entry.imported ? (
                  <span
                    style={{
                      fontSize: '.6875rem', fontWeight: 600, color: '#047857',
                      background: '#ecfdf5', border: '1px solid #a7f3d0',
                      borderRadius: '999px', padding: '5px 10px', whiteSpace: 'nowrap',
                    }}
                  >In your templates</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(entry)}
                    disabled={busy}
                    style={{ ...btn(A, '#fff', A), opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
                  >{busy ? 'Adding…' : 'Add to my templates'}</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
