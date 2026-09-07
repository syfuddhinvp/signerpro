import type { Metadata } from 'next';
import ApiScreen from '@/components/sf/screens/ApiScreen';
import { serverCaller } from '@/lib/api/client';
import { apiKeys as apiKeysApi, contacts as contactsApi, organizations as organizationsApi } from '@/lib/api/resources';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Developer · SignerPro Platform' };

export default async function Page() {
  const api = serverCaller('/platform/developer');

  const [keysResult, scopesResult, usageResult, settingsResult, contactsResult] = await Promise.all([
    apiKeysApi.list(api),
    apiKeysApi.scopes(api),
    apiKeysApi.usage(api),
    organizationsApi.apiSettings(api),
    // The "Launch embedded builder" action injects the first two contacts.
    contactsApi.list(api, { limit: 2 }),
  ]);

  return (
    <>
      {!keysResult.ok || !usageResult.ok || !settingsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Platform API keys and usage" detail={(keysResult.ok ? null : keysResult.error.message) ?? (usageResult.ok ? null : usageResult.error.message) ?? (settingsResult.ok ? null : settingsResult.error.message)} />
        </div>
      ) : null}
      <ApiScreen
        keys={keysResult.ok ? keysResult.data : []}
        scopeCatalogue={scopesResult.ok ? scopesResult.data : []}
        usage={usageResult.ok ? usageResult.data : null}
        apiSettings={settingsResult.ok ? settingsResult.data : null}
        embedContacts={contactsResult.ok ? contactsResult.data.items : []}
      />
    </>
  );
}
