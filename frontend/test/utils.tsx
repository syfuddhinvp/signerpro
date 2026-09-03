/** Shared render harness: the SF store provider every screen expects. */

import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';

export function renderWithSF(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, {
    wrapper: ({ children }) => <SFProvider>{children}</SFProvider>,
    ...options,
  });
}

export * from '@testing-library/react';
export { router, resetNavigation, setSearchParams, setPathname, navigationMock } from './navigation';
