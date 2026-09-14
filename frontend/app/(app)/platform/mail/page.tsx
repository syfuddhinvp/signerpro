import type { Metadata } from 'next';
import Mail from '@/components/sf/screens/Mail';
import { serverCaller } from '@/lib/api/client';
import { mail as mailApi } from '@/lib/api/resources';
import type { MailLogPage } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Mail outbox · SignerPro Platform' };

const SINCE_DAYS = 90;
const EMPTY_PAGE: MailLogPage = { items: [], total: 0, categories: [], statuses: [] };

export default async function Page() {
  const api = serverCaller('/platform/mail');
  const result = await mailApi.list(api, { since_days: SINCE_DAYS, limit: 200 });

  return (
    <Mail
      page={result.ok ? result.data : EMPTY_PAGE}
      /* An empty outbox and an unreachable API produce the same prop; the error
         is passed through so the screen can say which of the two happened. */
      loadError={result.ok ? null : result.error.message}
      sinceDays={SINCE_DAYS}
    />
  );
}
