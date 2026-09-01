import { notFound } from 'next/navigation';
import { AdminGuideTopicScreen } from '@/components/admin/screens/AdminGuideTopicScreen';
import { getAdminGuideTopic } from '@/lib/admin/guide/topics';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminGuideTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  /* params 해석은 게이트보다 앞설 수 있다 — 데이터 접근이 아니고, 게이트가
     로그인 복귀(next)에 쓸 실제 pathname을 만들려면 슬러그가 먼저 필요하다. */
  const { topic } = await params;
  await requireAdminScreenAccess(`/admin/guide/${topic}`);

  const guideTopic = getAdminGuideTopic(topic);
  if (!guideTopic) notFound();

  return <AdminGuideTopicScreen topic={guideTopic} />;
}
