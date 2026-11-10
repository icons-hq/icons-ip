import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { loadPublicReviewEvent } from '@/lib/review-events.server';
import { ReviewEventScreen } from '@/components/screens/ReviewEvents';
export const metadata: Metadata = { title: '리뷰이벤트 안내 — ICONS' };
export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventId } = await params; if (!isUuid(eventId)) notFound();
  const query = await searchParams, page = typeof query.page === 'string' && /^[1-9]\d{0,4}$/.test(query.page) ? Number(query.page) : 1;
  const data = await loadPublicReviewEvent(eventId, page); if (!data) notFound();
  return <ReviewEventScreen data={data} />;
}
