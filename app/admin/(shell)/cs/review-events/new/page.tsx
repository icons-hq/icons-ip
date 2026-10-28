import { randomUUID } from 'node:crypto';
import { canAccessAdminScreen } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminScreenForPath } from '@/lib/admin/navigation';
import { loadReviewEventCreditPolicy } from '@/lib/admin/review-events.server';
import { REVIEW_EVENTS_ADMIN_PATH } from '@/lib/review-events';
import { ReviewEventEditorScreen } from '@/components/admin/screens/ReviewEventEditorScreen';

const STORE_CREDIT_POLICY_PATH = '/admin/settings/store-credits';

export default async function Page() {
  const auth = await requireAdminScreenAccess(`${REVIEW_EVENTS_ADMIN_PATH}/new`);
  /* R6: 등록 화면은 workspace가 없어 정책 상태를 cs.manage 전용 읽기로 따로 받는다. 설정 링크는 설정 페이지와 같은 게이트를 통과할 때만. */
  const creditPolicy = await loadReviewEventCreditPolicy();
  const policyHref = canAccessAdminScreen(auth, adminScreenForPath(STORE_CREDIT_POLICY_PATH), { adminOnly: true }) ? STORE_CREDIT_POLICY_PATH : null;
  return <ReviewEventEditorScreen id={randomUUID()} workspace={null} creditPolicy={creditPolicy} policyHref={policyHref} />;
}
