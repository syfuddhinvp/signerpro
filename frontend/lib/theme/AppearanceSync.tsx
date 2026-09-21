'use client';
/**
 * The authenticated app's half of the theme system: adopts the appearance the
 * server layout loaded from the account, and writes every later change back
 * to `PUT /api/me/appearance` so the same look follows the user between
 * browsers. Mounted once, inside the app layout, below ThemeProvider.
 */
import { useEffect, useRef } from 'react';
import { apiCall } from '@/lib/api/browser';
import { account as accountApi } from '@/lib/api/resources';
import { useTheme } from './ThemeProvider';
import type { Appearance } from './themes';

export default function AppearanceSync({ appearance }: { appearance: Appearance | null }) {
  const { adopt, onPersist } = useTheme();
  const adopted = useRef(false);

  useEffect(() => {
    /* The account wins over this browser's memory, once, on arrival. A null
       means the endpoint failed: keep what the browser has rather than reset
       the user to the default because the API blinked. */
    if (appearance && !adopted.current) { adopted.current = true; adopt(appearance); }
  }, [appearance, adopt]);

  useEffect(() => onPersist(next => {
    /* Fire and forget: the page is already painted in the new theme, and the
       browser copy is already written. A failed save is noticed on the next
       device, not by a toast over a change that visibly worked. */
    void accountApi.updateAppearance(apiCall, next);
  }), [onPersist]);

  return null;
}
