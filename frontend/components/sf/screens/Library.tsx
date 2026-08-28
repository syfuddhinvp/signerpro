'use client';

/* SignForge — DOCUMENT LIBRARY screen (isDash). Ported verbatim from the prototype. */

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, pill, linkBtn } from '@/lib/sf/ui';
import {
  QUICK_ACCESS, LIB_FOLDERS, LIB_FILTER_DEFS, LIB_SORT_OPTIONS, ROW_ACTIONS,
  STATUS, TEMPLATES,
} from '@/lib/sf/data';

export default function Library() {
  const { s, set, flash, accent, libDocsFiltered } = useSF();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const libFolderLabel = (
    (QUICK_ACCESS as [string, string, number, string][])
      .map(f => [f[0], f[1]] as [string, string])
      .concat(LIB_FOLDERS.map(f => [f[0], f[1]] as [string, string]))
      .find(f => f[0] === s.libFolder) || ['', 'Documents']
  )[1];

  const isTemplateFolder = s.libFolder === 'templates';
  const libDocs = libDocsFiltered();

  const libCountLabel =
    (isTemplateFolder ? TEMPLATES.length : libDocs.length) +
    (isTemplateFolder ? ' templates' : ' documents');

  const filterSelectStyle: CSSProperties = {
    height: '30px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 9px',
    fontSize: '12px', background: '#fff', color: '#334155', outline: 'none',
  };

  const libFilters = LIB_FILTER_DEFS.map(([key, opts]) => ({
    key,
    value: (s as unknown as Record<string, string>)[key],
    options: opts.map(([id, label]) => ({ id, label })),
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      set({ [key]: v } as never);
    },
    style: filterSelectStyle,
  }));

  const libSortOptions = LIB_SORT_OPTIONS.map(([id, label]) => ({ id, label }));

  const libRows = (isTemplateFolder ? TEMPLATES : libDocs).map((d: any, i: number) => {
    const isTpl = isTemplateFolder;
    const st = isTpl ? STATUS.completed : STATUS[d.status];
    const checked = s.libSelected.indexOf(d.id) > -1;
    return {
      id: d.id,
      title: d.title,
      checked: checked ? 'true' : 'false',
      meta: isTpl
        ? d.id + ' · ' + d.fields + ' fields · used ' + d.uses + '× · updated ' + d.updated
        : d.id + ' · ' + d.pages + ' pages · updated ' + d.updated,
      statusLabel: isTpl ? 'Template' : st.label,
      pillStyle: pill(isTpl ? { bg: '#eef2ff', fg: '#3730a3', bd: '#c7d2fe' } : st),
      signers: isTpl ? 'Owner ' + d.owner : 'Signers: ' + (d.total || 1),
      rowStyle: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
        borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: checked ? '#f8faff' : 'transparent', flexWrap: 'wrap',
      } as CSSProperties,
      onCheck: () => set(st2 => ({
        libSelected: checked ? st2.libSelected.filter(x => x !== d.id) : st2.libSelected.concat([d.id]),
      })),
      thumb: {
        width: '40px', height: '50px', borderRadius: '5px', background: '#fff',
        border: '1px solid #e3e7ee', flex: '0 0 40px', display: 'flex',
        flexDirection: 'column', gap: '3px', padding: '6px 5px', overflow: 'hidden',
      } as CSSProperties,
      line1: { height: '2px', background: '#cbd5e1', borderRadius: '2px' } as CSSProperties,
      line2: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '82%' } as CSSProperties,
      line3: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '64%' } as CSSProperties,
      line4: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '74%' } as CSSProperties,
      onOpen: () => set({ screen: 'builder', wizardStep: 1 }),
      primaryLabel: isTpl ? 'Use template' : (d.status === 'draft' ? 'Prepare and send' : 'Invite to sign'),
      onPrimary: () => set({ screen: 'builder', wizardStep: 1 }),
      onTemplate: () => flash(isTpl ? 'Template duplicated' : d.title + ' saved as a template'),
      menuOpen: s.menuDoc === d.id,
      onMenu: (e: React.MouseEvent) => {
        e.stopPropagation();
        set({ menuDoc: s.menuDoc === d.id ? null : d.id });
      },
      menuBtn: {
        width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
        background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '13px',
        lineHeight: 1, flex: '0 0 28px',
      } as CSSProperties,
      actions: ROW_ACTIONS.map(([label, target]) => ({
        label,
        onClick: () => {
          set({ menuDoc: null, screen: target || s.screen, wizardStep: 1 });
          if (!target) flash(label + ' — ' + d.title);
        },
        style: {
          display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
          borderRadius: '7px', border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: '12.5px',
          color: (label === 'Delete' || label === 'Archive') ? '#b91c1c' : '#334155',
        } as CSSProperties,
      })),
    };
  });

  const hasLibSelection = s.libSelected.length > 0;
  const libSelectedLabel = s.libSelected.length ? s.libSelected.length + ' selected' : '';
  const libBulk = ['Move', 'Archive', 'Download', 'Delete'].map(label => ({
    label,
    onClick: () => {
      flash(label + ' — ' + s.libSelected.length + ' item(s)');
      set({ libSelected: [] });
    },
    style: btn('#fff', label === 'Delete' ? '#b91c1c' : '#475569', label === 'Delete' ? '#fecaca' : '#e3e7ee'),
  }));

  const libListBtn = btn(
    s.libView === 'list' ? '#eef2ff' : '#fff',
    s.libView === 'list' ? '#3730a3' : '#475569',
    s.libView === 'list' ? '#c7d2fe' : '#e3e7ee');
  const libGridBtn = btn(
    s.libView === 'grid' ? '#eef2ff' : '#fff',
    s.libView === 'grid' ? '#3730a3' : '#475569',
    s.libView === 'grid' ? '#c7d2fe' : '#e3e7ee');

  return (
    <section data-screen-label="Documents" style={{ display: 'flex', minHeight: '100%', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, letterSpacing: '-.3px' }}>{libFolderLabel}</h2>
            <span style={{ fontSize: '12px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{libCountLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: '7px', flex: '0 0 auto' }}>
            <button type="button" onClick={() => flash('Folder created in ' + libFolderLabel)} style={ghostBtn}>New folder</button>
            <button type="button" onClick={() => set({ screen: 'builder' })} style={primaryBtn}>Upload &amp; prepare</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {libFilters.map(f => (
            <select key={f.key} value={f.value} onChange={f.onChange} style={f.style} aria-label="Filter">
              {f.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          ))}
          <button
            type="button"
            onClick={() => set({ libStatus: 'all', libType: 'all', libTime: 'all', libOwner: 'all', query: '' })}
            style={linkBtn(A)}
          >Reset filters</button>
          <input
            type="search"
            value={s.query}
            onChange={e => set({ query: e.target.value })}
            placeholder="Search documents and forms"
            aria-label="Search documents"
            style={{ height: '30px', flex: 1, minWidth: '180px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 10px', fontSize: '12.5px', outline: 'none', background: '#fff' }}
          />
          <select
            value={s.libSort}
            onChange={e => set({ libSort: e.target.value })}
            aria-label="Sort"
            style={{ height: '30px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 9px', fontSize: '12px', background: '#fff', color: '#334155', outline: 'none' }}
          >
            {libSortOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => set({ libView: 'list' })} style={libListBtn}>List</button>
          <button type="button" onClick={() => set({ libView: 'grid' })} style={libGridBtn}>Grid</button>
        </div>

        {hasLibSelection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: '11px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#3730a3' }}>{libSelectedLabel}</span>
            <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
              {libBulk.map(b => (
                <button key={b.label} type="button" onClick={b.onClick} style={b.style}>{b.label}</button>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', overflow: 'visible' }}>
          {libRows.map(d => (
            <div key={d.id} style={d.rowStyle}>
              <button
                type="button"
                role="checkbox"
                aria-checked={d.checked === 'true'}
                aria-label="Select"
                onClick={d.onCheck}
                style={{ width: '17px', height: '17px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', flex: '0 0 17px' }}
              />
              <span style={d.thumb}>
                <span style={d.line1} /><span style={d.line2} /><span style={d.line3} /><span style={d.line4} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: '1 1 240px', minWidth: '200px' }}>
                <button
                  type="button"
                  onClick={d.onOpen}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: '13.5px', fontWeight: 600, color: '#0f172a', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >{d.title}</button>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.meta}</span>
                <span style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={d.pillStyle}>{d.statusLabel}</span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{d.signers}</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                <button type="button" onClick={d.onPrimary} style={primaryBtn}>{d.primaryLabel}</button>
                <button type="button" onClick={d.onTemplate} style={ghostBtn}>Make template</button>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-expanded={d.menuOpen}
                    onClick={d.onMenu}
                    style={d.menuBtn}
                  >···</button>
                  {d.menuOpen ? (
                    <div
                      role="menu"
                      data-sf-scroll="1"
                      style={{ position: 'absolute', right: 0, top: '32px', width: '230px', maxHeight: '320px', overflow: 'auto', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '12px', boxShadow: '0 18px 40px -18px rgba(15,23,42,.35)', padding: '6px', zIndex: 30, animation: 'sfIn .12s ease' }}
                    >
                      {d.actions.map(ac => (
                        <button key={ac.label} type="button" role="menuitem" onClick={ac.onClick} style={ac.style}>{ac.label}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
