import type { Metadata } from 'next';
import InviteForm from '@/components/sf/auth/InviteForm';

export const metadata: Metadata = { title: 'Accept your invitation · SignForge', robots: { index: false } };

/** Landing page for the emailed link `{app_base_url}/invite/{token}`. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteForm token={token} />;
}
