'use client';
/* Which field types the builder palette offers, chosen by an org admin under
   My account → Organization and stored on `organizations.enabled_field_types`.

   The palette ships every type the product implements, which is more than most
   tenants ever place: a workspace that only sends a signature and a date had to
   read past fifteen tiles to find them. This narrows the palette to what the
   organization actually uses.

   Authoring only. A document or template already carrying a type that is no
   longer offered keeps rendering it — `metaOf` resolves the tile from `TYPES`
   regardless of what is enabled, so narrowing the palette can never break an
   envelope that is already out. */
import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/api/browser';
import { organizations as organizationsApi } from '@/lib/api/resources';
import { builderFieldType } from './adapters';

export type EnabledFieldTypes = {
  /** Builder type ids the palette may offer, or `null` for "every type". */
  enabled: string[] | null;
  /** False until the organization's choice has arrived. */
  ready: boolean;
};

/** True when `typeId` may be placed, given a loaded choice. */
export function fieldTypeEnabled(enabled: string[] | null, typeId: string): boolean {
  return enabled === null || enabled.indexOf(typeId) > -1;
}

export function useEnabledFieldTypes(): EnabledFieldTypes {
  /* `null` is both the "not loaded yet" and the "no restriction" value, and
     that is deliberate: until the choice arrives the palette shows everything,
     which is what it did before this setting existed. Hiding tiles first and
     revealing them on load would make the palette flicker on every render. */
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void organizationsApi.me(apiCall).then(result => {
      if (!live) return;
      // Defended rather than trusted: this runs on every builder mount, and a
      // shape it did not expect must not blank the palette.
      const types = result.ok && Array.isArray(result.data?.enabled_field_types)
        ? result.data.enabled_field_types
        : null;
      if (types && types.length) setEnabled(types.map(builderFieldType));
      // A failed load leaves the full palette rather than an empty one: an
      // author who cannot reach the API should still be able to place a field.
      setReady(result.ok);
    });
    return () => { live = false; };
  }, []);

  return { enabled, ready };
}
