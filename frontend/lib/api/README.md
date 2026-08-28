# Data-access layer

How the SignForge frontend talks to the SignFlow FastAPI backend, and how to
convert one mocked screen at a time onto it.

The reference conversion is **Contacts** — `app/(app)/contacts/page.tsx` +
`components/sf/screens/Contacts.tsx`. Copy it.

## The files

| File | Role |
|---|---|
| `lib/api/result.ts` | Isomorphic core: `ApiResult<T>`, `ApiError`, `requestJson`, query-string and `detail` parsing. No cookies, no `server-only` — safe in both bundles. |
| `lib/api/client.ts` | **Server** transport. `apiFetch` / `apiFetchPublic` / `apiFetchOrLogin` / `serverCaller`. Reads the httpOnly `sf_session` cookie via `lib/auth/session.ts` and attaches `Authorization: Bearer …`. `import 'server-only'` — never import from a client component. |
| `lib/api/browser.ts` | **Browser** transport. `apiCall` rewrites `/api/x` → `/api/proxy/x`; the token stays server-side. |
| `app/api/proxy/[...path]/route.ts` | The catch-all that re-attaches the bearer token and forwards method, query, JSON body and status to `<BACKEND_URL>/api/…`. Only `/api/*` targets are reachable; traversal segments are rejected; no session ⇒ 401. |
| `lib/api/types.ts` | Hand-written mirrors of `backend/app/schemas/*.py`. **snake_case, exactly as the API returns.** |
| `lib/api/resources.ts` | One thin typed function per endpoint, grouped by domain. No React. |
| `lib/sf/adapters.ts` | Pure API-shape → prototype-shape mappers. This is the only place a name is allowed to change. |

Rule of thumb: **types and resources speak the API's language; adapters speak
the prototype's; components never learn the API exists.**

## Errors

Every call returns a discriminated result — nothing throws:

```ts
type ApiResult<T> =
  | { ok: true;  status: number; data: T }
  | { ok: false; status: number; error: ApiError };
```

`ApiError.kind` is one of `unauthorized` (401 — redirect to `/login`),
`forbidden` (403), `not_found` (404 — also what a cross-tenant id returns),
`conflict` (409), `validation` (422, with `issues: {loc, msg, type}[]`),
`client` (other 4xx), `server` (5xx), `network` (fetch threw / backend down).

Helpers: `unwrapOr(result, fallback)`, `isUnauthorized(result)`,
`errorMessage(result)`, and on the server `redirectToLogin(next)`.

## Converting a screen — the recipe

1. **Find the endpoints.** Read the router in `backend/app/api/routes/` and the
   schema in `backend/app/schemas/`. The routers are the source of truth;
   `INTEGRATION_PLAN.md` predates them.
2. **Add the types** to `lib/api/types.ts` if the resource is not there yet.
   Field names snake_case, `datetime` → `string`, `X | None` → `X | null`.
3. **Add the resource functions** to the right group in `lib/api/resources.ts`:
   ```ts
   export const contacts = {
     list: (c: Caller, params?: T.ContactListParams) =>
       get<T.ContactListResponse>(c, '/api/contacts', params),
     …
   };
   ```
   Every function takes a `Caller` first — that is what lets the same function
   run on the server (`serverCaller()`) and in the browser (`apiCall`).
4. **Write the adapter** in `lib/sf/adapters.ts`, mapping the response to the
   shape the component already reads (look at the mock constant in
   `lib/sf/data.ts` it currently renders). Where the design shows a field the
   API lacks, leave a `FALLBACK:` comment saying what you substituted.
5. **Make the page a server component**:
   ```tsx
   import { serverCaller } from '@/lib/api/client';
   import { contacts as contactsApi } from '@/lib/api/resources';
   import { toContacts } from '@/lib/sf/adapters';

   export default async function Page() {
     const api = serverCaller('/contacts');            // 401 → /login?next=/contacts
     const [listResult] = await Promise.all([contactsApi.list(api, { limit: 200 })]);
     const list = listResult.ok ? listResult.data : { items: [], total: 0, counts: {} };
     return <Contacts contacts={toContacts(list.items)} … />;
   }
   ```
   Fetch in parallel with `Promise.all`. Always give a fallback for a failed
   call so the screen degrades instead of throwing.
6. **Give the screen props instead of mocks.** Export a `…Props` type, take the
   data as parameters, and delete the `s.<mock>` reads. Client-only UI state
   (search text, selected tab, selected row) stays in `lib/sf/state.tsx` — only
   *data* moves to props. **The markup and styling must not change.** If the
   prototype's helper (`contactsFiltered`) read the mock array, inline the same
   predicate over the prop.
7. **Guard the empty case.** The prototype's data was never empty; a fresh
   tenant's is. Add an explicit empty branch rather than letting `list[0]` be
   `undefined`.
8. **Mutations** — optimistic toast first, then the call, then refresh:
   ```tsx
   const router = useRouter();
   flash(name + ' saved');                              // keep prototype behaviour
   void contactsApi.create(apiCall, { name, email, … }).then(res => {
     if (!res.ok) { flash('Could not save · ' + res.error.message); return; }
     router.refresh();                                  // re-runs the server page
   });
   ```
   A server action is equivalent and preferable for form posts: call
   `apiFetch` inside `'use server'` and `revalidatePath()`.
9. **Check it**: `npx tsc --noEmit` and `npx next build` must both be clean.

## Don't

- Don't import `lib/api/client.ts` from a `'use client'` file — use
  `lib/api/browser.ts`.
- Don't camelCase API fields in `types.ts`.
- Don't put formatting in `resources.ts` or fetching in `adapters.ts`.
- Don't edit the ported markup while converting a screen. If a component truly
  cannot render the API's data, add an adapter, not a component change.
