import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { StoreCreditAdjustmentForm } from '@/components/admin/screens/StoreCreditForms';
import { StoreCreditBalance, StoreCreditHistoryList } from '@/components/screens/MyStoreCredits';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isCustomerId } from '@/lib/admin/customer-detail';
import { loadAdminStoreCreditHistory } from '@/lib/admin/store-credits.server';

export default async function Page({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await params;
  if (!isCustomerId(userId)) notFound();
  const path = `/admin/customers/${userId}/store-credits`;
  await requireAdminScreenAccess(path, { adminOnly: true });
  const query = await searchParams;
  const value = Number(typeof query.page === 'string' ? query.page : 1);
  const page = Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : 1;
  const history = await loadAdminStoreCreditHistory(userId, page);
  return <section className="wc-admin-kit">
    <AdminPageHeader title="고객 적립금" description="지급·차감 정정은 사유와 함께 기록합니다. 사용 대기 금액과 만료된 금액은 차감할 수 없습니다." actions={<Link href={`/admin/customers/${userId}`}>고객 상세로 돌아가기</Link>} />
    <AdminSectionCard title="잔액"><StoreCreditBalance history={history} /></AdminSectionCard>
    <AdminSectionCard title="단건 적립금 조정"><StoreCreditAdjustmentForm userId={userId} available={history.available} enabled={history.enabled} operationId={crypto.randomUUID()} /></AdminSectionCard>
    <AdminSectionCard title="적립금 이력"><StoreCreditHistoryList history={history} pagePath={path} /></AdminSectionCard>
  </section>;
}
