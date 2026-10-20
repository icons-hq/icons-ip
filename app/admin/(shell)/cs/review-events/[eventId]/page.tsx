import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminReviewEvent } from '@/lib/admin/review-events.server';
import { REVIEW_EVENTS_ADMIN_PATH } from '@/lib/review-events';
import { ReviewEventEditorScreen } from '@/components/admin/screens/ReviewEventEditorScreen';
import { searchReviewEventTargetsAction } from '@/app/admin/review-event-actions';
import { isUuid } from '@/lib/uuid';
export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(REVIEW_EVENTS_ADMIN_PATH);
  const { eventId } = await params; if (!isUuid(eventId)) notFound();
  const raw = await searchParams, query = typeof raw.q === 'string' ? raw.q.slice(0, 100) : '', filter = typeof raw.filter === 'string' && ['all', 'eligible', 'selected', 'awarded', 'revoked', 'unavailable'].includes(raw.filter) ? raw.filter : 'all';
  const page = typeof raw.page === 'string' && /^[1-9]\d{0,4}$/.test(raw.page) ? Number(raw.page) : 1;
  const workspace = await loadAdminReviewEvent(eventId, page, query, filter); if (!workspace) notFound();
  const targets = workspace.event.targetType === 'all' ? null : await searchReviewEventTargetsAction(workspace.event.targetType, '', 1, workspace.event.targetType === 'goods' ? workspace.event.goodIds : workspace.event.categoryIds);
  return <ReviewEventEditorScreen key={`${eventId}:${page}:${query}:${filter}`} id={eventId} workspace={workspace} targetLabels={targets?.data?.rows ?? []} query={query} filter={filter} />;
}
