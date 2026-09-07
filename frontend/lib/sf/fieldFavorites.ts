'use client';
/* The builder palette's Favourites tab, backed by the account rather than by
   the bundle. `s.favTypes` used to be a hardcoded seed in the store with
   nothing writing to it, so the tab was decorative: this hook loads the user's
   starred types from `GET /api/me/field-favorites` and writes every toggle
   back, so the same tiles are starred on every device the account signs in on. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/api/browser';
import { account as accountApi } from '@/lib/api/resources';
import { apiFieldType, builderFieldType } from './adapters';
import { useSF } from './state';

export function useFieldFavorites() {
  const { s, set, flash } = useSF();
  const favRef = useRef<string[]>(s.favTypes);
  favRef.current = s.favTypes;
  /* Until the account's own set has arrived the store still holds the seed, and
     a toggle in that window would persist the seed as if the user had chosen
     it. Toggling stays inert until then. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void accountApi.fieldFavorites(apiCall).then(result => {
      if (!live) return;
      // `types` is defended rather than trusted: this runs on mount for every
      // builder render, and a shape it did not expect must not blank the palette.
      const types = result.ok && Array.isArray(result.data?.types) ? result.data.types : null;
      if (types) set({ favTypes: types.map(builderFieldType) });
      // A failed load is not worth a toast: the palette simply keeps the seed,
      // and the next toggle is what the user will notice if the API is down.
      setLoaded(types !== null);
    });
    return () => { live = false; };
  }, [set]);

  const isFavorite = useCallback((typeId: string) => favRef.current.indexOf(typeId) > -1, []);

  const toggleFavorite = useCallback((typeId: string) => {
    if (!loaded) return;
    const current = favRef.current;
    const on = current.indexOf(typeId) > -1;
    // Starred order is the order they were starred in, so a re-star appends.
    const next = on ? current.filter(t => t !== typeId) : current.concat([typeId]);
    set({ favTypes: next });
    void accountApi.updateFieldFavorites(apiCall, next.map(apiFieldType)).then(result => {
      if (result.ok) {
        if (Array.isArray(result.data?.types)) set({ favTypes: result.data.types.map(builderFieldType) });
        return;
      }
      // Put the star back rather than leave the palette claiming a preference
      // the account does not hold.
      set({ favTypes: current });
      flash('Could not save favourites — ' + result.error.message);
    });
  }, [loaded, set, flash]);

  return { isFavorite, toggleFavorite, favoritesReady: loaded };
}
