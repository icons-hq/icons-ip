import { loadAdminHomeAttention } from '@/lib/admin/home-attention.server';
import { loadAdminWorkQueue } from '@/lib/admin/work-queue.server';
import { redirect } from 'next/navigation';
import { OverviewSection } from '@/components/admin/sections/Overview';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminInsights } from '@/lib/admin/insights.server';
import { getAdminModerationRecords } from '@/lib/admin/moderation.server';
import { ADMIN_SCREENS, legacyAdminSectionHref } from '@/lib/admin/navigation';
import { adminInsightPeriod } from '@/lib/admin/home-summary';
import { loadAdminHomeSummary } from '@/lib/admin/home-summary.server';
import { canAccessAdminScreen, hasAdminCapability, operatorAccessOf } from '@/lib/admin/access';
import { OperatorOverview } from '@/components/admin/sections/OperatorOverview';

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  /*
   * 옛 `?section=` 딥링크를 새 라우트로 넘긴다. 인증보다 먼저 하는 이유는
   * 로그인 후 원래 가려던 화면으로 돌아가게 하기 위해서다 — 여기서 막으면
   * next가 항상 /admin이 된다. 나머지 쿼리(주문 필터 등)는 그대로 옮긴다.
   */
  const legacyHref = legacyAdminSectionHref(query.section);
  if (legacyHref) {
    const carried = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === 'section' || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) carried.append(key, item);
    }
    const search = carried.toString();
    redirect(search ? `${legacyHref}?${search}` : legacyHref);
  }

  const auth = await requireAdminScreenAccess('/admin');
  if (!hasAdminCapability(auth, 'platform.manage')) {
    const attention = hasAdminCapability(auth, 'cs.manage') ? await loadAdminHomeAttention().catch(() => undefined) : undefined;
    return <OperatorOverview role={auth.role ?? 'staff'} access={operatorAccessOf(auth)} attention={attention} />;
  }

  const days = adminInsightPeriod(query.period);
  /* 무통장 입금 대기·환불 송금 대기는 목적지 화면을 열 수 있는 계정에만 집계한다(환불 송금 대기는 관리자 전용). */
  const canOpen = (screenId: string) => canAccessAdminScreen(auth, ADMIN_SCREENS.find((screen) => screen.id === screenId) ?? null);
  /* 통계와 신고는 조회가 순차로 세 번씩 이어져 가장 늦다. 기다리지 않고 Promise째 넘겨 그 칸만 나중에 채운다 — 업무 큐가 먼저 보인다. */
  const insights = getAdminInsights(days).catch(() => null);
  const reports = getAdminModerationRecords().then((moderation) => moderation.reports).catch(() => null);
  const [workQueue, summary, attention] = await Promise.all([
    loadAdminWorkQueue({ unpaid: canOpen('unpaid'), refundTransfers: canOpen('refund-transfers') }),
    loadAdminHomeSummary().catch(() => undefined),
    loadAdminHomeAttention().catch(() => undefined),
  ]);

  return <OverviewSection insights={insights} reports={reports} workQueue={workQueue} summary={summary} days={days} attention={attention} />;
}
