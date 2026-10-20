import { randomUUID } from 'node:crypto';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { REVIEW_EVENTS_ADMIN_PATH } from '@/lib/review-events';
import { ReviewEventEditorScreen } from '@/components/admin/screens/ReviewEventEditorScreen';
export default async function Page() {
  await requireAdminScreenAccess(`${REVIEW_EVENTS_ADMIN_PATH}/new`);
  return <ReviewEventEditorScreen id={randomUUID()} workspace={null} />;
}
