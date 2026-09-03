/**
 * Standalone `next/navigation` stub.
 *
 * Kept free of any app import: `vi.mock('next/navigation')`'s factory loads
 * this module, and anything it pulled in that itself imports `next/navigation`
 * would deadlock the mock.
 */
import { vi } from 'vitest';

export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let searchParams = new URLSearchParams();
let pathname = '/';

export function setSearchParams(query: string): void { searchParams = new URLSearchParams(query); }
export function setPathname(next: string): void { pathname = next; }

export function resetNavigation(): void {
  Object.values(router).forEach(fn => fn.mockClear());
  searchParams = new URLSearchParams();
  pathname = '/';
}

/** Install with `vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());` */
export function navigationMock() {
  return {
    useRouter: () => router,
    useSearchParams: () => searchParams,
    usePathname: () => pathname,
    useParams: () => ({}),
    redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
    notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  };
}
