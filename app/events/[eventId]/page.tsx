/* 레거시 딥링크 브리지 — /events/<id>로 저장·공유된 오프라인 팝업 링크를 새 경로로 넘긴다.
   캠페인 우선 조회가 다음 단계에서 이 앞에 삽입된다(S8 W2). */

import { notFound, permanentRedirect } from 'next/navigation';
import { getCatalogSnapshot } from '@/lib/catalog';

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const catalog = await getCatalogSnapshot();
  if (!catalog.events.some((event) => event.id === eventId)) notFound();
  permanentRedirect(`/offline-popups/${encodeURIComponent(eventId)}`);
}
