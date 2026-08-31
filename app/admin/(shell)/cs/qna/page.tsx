import { QnaConsoleScreen } from '@/components/admin/screens/QnaConsoleScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminProductQuestionFilters } from '@/lib/admin/product-questions';
import { getAdminProductQuestionConsoleData } from '@/lib/admin/product-questions.server';

export default async function AdminCsQnaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 질문 조회를 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/cs/qna');
  const query = await searchParams;

  const data = await getAdminProductQuestionConsoleData(
    normalizeAdminProductQuestionFilters(query),
  );

  return <QnaConsoleScreen data={data} />;
}
