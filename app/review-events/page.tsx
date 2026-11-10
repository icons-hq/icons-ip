import type { Metadata } from 'next';
import { loadPublicReviewEvents } from '@/lib/review-events.server';
import { ReviewEventsScreen } from '@/components/screens/ReviewEvents';
export const metadata: Metadata = { title: '리뷰이벤트 — ICONS', description: '직접 써 본 굿즈 이야기를 들려주세요. 진행 중인 리뷰이벤트와 당첨자 발표를 확인하세요.' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams, page = typeof query.page === 'string' && /^[1-9]\d{0,4}$/.test(query.page) ? Number(query.page) : 1;
  return <ReviewEventsScreen page={page} data={await loadPublicReviewEvents(page)} />;
}
