import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyStoreCreditHistory } from '@/lib/store-credits.server';
import { MyStoreCredits } from '@/components/screens/MyStoreCredits';
export const metadata: Metadata = { title: '적립금 — ICONS', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/store-credits')}`);
  const params = await searchParams;
  const parsed = Number(typeof params.page === 'string' ? params.page : 1);
  const page = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : 1;
  const history = await loadMyStoreCreditHistory(page).catch(() => null);
  return <MyStoreCredits history={history} />;
}
