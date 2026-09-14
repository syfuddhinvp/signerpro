/**
 * The guides screen.
 *
 * The rail used to list five developer pages and nothing else, so the first
 * thing an everyday user met was "Create an API key". This pins the grouped
 * rail, the plain-language landing page, and that every page in the nav
 * actually resolves to content rather than falling back to the quickstart.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DOC_NAV, DOCS_PAGES } from '@/lib/sf/data';
import Guides from './Guides';

afterEach(cleanup);

const mount = () => render(<SFProvider><Guides /></SFProvider>);

describe('Guides', () => {
  it('lands on the plain-language overview, not the API quickstart', () => {
    mount();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('What SignerPro does');
  });

  it('groups the rail so user pages come before the developer reference', () => {
    const groups = DOC_NAV.map(([, , g]) => g);
    expect(groups.indexOf('Developers')).toBeGreaterThan(groups.lastIndexOf('Getting started'));
    mount();
    for (const group of ['Getting started', 'Everyday use', 'Developers']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
  });

  it('has real content behind every nav entry', () => {
    for (const [id] of DOC_NAV) {
      const page = (DOCS_PAGES as Record<string, { sections: unknown[] }>)[id];
      expect(page, id).toBeTruthy();
      expect(page.sections.length, id).toBeGreaterThan(2);
    }
  });

  it('walks to the next page from the article footer', () => {
    mount();
    const [, next] = DOC_NAV;
    const footer = screen.getByRole('navigation', { name: 'Guide pages' });
    fireEvent.click(within(footer).getByRole('button', { name: new RegExp(next[1]) }));
    expect(screen.getByRole('heading', { level: 2 }).textContent)
      .toBe((DOCS_PAGES as Record<string, { title: string }>)[next[0]].title);
  });

  /**
   * The developer pages used to describe an API that was never built: an
   * `Authorization: Bearer` header no route reads, a `https://api.signerpro.com/v1`
   * host, `POST /v1/documents` and `/invite`, a `signerpro-signature` webhook
   * header, and `envelope.*` events. Every one of those would have cost a
   * developer an afternoon. These pin the parts that are checkable as data.
   */
  describe('the developer pages describe the API that exists', () => {
    const devText = ['quickstart', 'reference', 'embed', 'webhooks', 'migration']
      .map(id => JSON.stringify((DOCS_PAGES as Record<string, unknown>)[id]))
      .join(' ');

    it('authenticates with X-API-Key, never a bearer token', () => {
      expect(devText).toContain('X-API-Key');
      expect(devText).not.toMatch(/Authorization: Bearer/);
    });

    it('uses the deployed base path, not a marketing hostname', () => {
      expect(devText).toContain('/api/v1');
      expect(devText).not.toContain('api.signerpro.com');
    });

    it('names the real webhook headers and event catalogue', () => {
      const hooks = JSON.stringify(DOCS_PAGES.webhooks);
      expect(hooks).toContain('X-SignFlow-Signature');
      expect(hooks).toContain('X-SignFlow-Delivery');
      expect(hooks).toContain('document.completed');
      expect(hooks).not.toContain('signerpro-signature');
      expect(hooks).not.toContain('envelope.completed');
    });

    it('claims no write endpoints the public surface does not expose', () => {
      expect(devText).not.toMatch(/POST \/v1\//);
      expect(devText).not.toContain('/v1/imports');
      expect(JSON.stringify(DOCS_PAGES.quickstart)).toContain('not public yet');
    });
  });
});
