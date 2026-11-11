import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { REVIEW_EVENT_TEMPLATES_ADMIN_PATH } from '@/lib/review-events';
import { ReviewEventTemplatesScreen } from '@/components/admin/screens/ReviewEventTemplatesScreen';

/* SHEET-017: 리뷰이벤트 화면의 하위 경로라 같은 게이트(cs.manage, 리뷰 이벤트 메뉴)를 쓴다. 목록은 화면이 서버 액션으로 읽는다. */
export default async function Page() {
  await requireAdminScreenAccess(REVIEW_EVENT_TEMPLATES_ADMIN_PATH);
  return <ReviewEventTemplatesScreen />;
}
