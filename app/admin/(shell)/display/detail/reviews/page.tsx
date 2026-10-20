import { DetailReviewBestScreen } from '@/components/admin/screens/DetailReviewBestScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadReviewBestSettings } from '@/lib/review-best.server';
import { REVIEW_BEST_SETTINGS_PATH } from '@/lib/review-best';

export default async function AdminDetailReviewBestPage() {
  await requireAdminScreenAccess(REVIEW_BEST_SETTINGS_PATH, { capability: 'store.manage' });
  return <DetailReviewBestScreen initial={await loadReviewBestSettings()} />;
}
