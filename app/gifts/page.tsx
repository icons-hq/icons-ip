import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GiftList } from '@/components/screens/gifts/GiftList';
import { getCurrentAuthState } from '@/lib/auth/server';
import { giftsAvailable, loadGifts } from '@/lib/gifts.server';
import { isUuid } from '@/lib/uuid';
import { transactionInstant } from '@/lib/goods-transaction-values';
export const metadata: Metadata = { title: '선물함 — ICONS' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getCurrentAuthState(); if (!auth.user) redirect('/login?next=%2Fgifts');
  const query = await searchParams, party = query.party === 'recipient' ? 'recipient' : 'sender';
  const cursor = typeof query.before === 'string' && transactionInstant(query.before) && typeof query.id === 'string' && isUuid(query.id) ? { createdAt: query.before, id: query.id } : undefined;
  const [page, available] = await Promise.all([loadGifts(party, cursor), giftsAvailable()]);
  return <GiftList page={page} party={party} available={available} />;
}
