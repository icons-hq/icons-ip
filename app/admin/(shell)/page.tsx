import { loadAdminHomeAttention } from '@/lib/admin/home-attention.server';
import { loadAdminWorkQueue } from '@/lib/admin/work-queue.server';
import { redirect } from 'next/navigation';
import { OverviewSection } from '@/components/admin/sections/Overview';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminInsights } from '@/lib/admin/insights.server';
import { getAdminModerationRecords } from '@/lib/admin/moderation.server';
import { legacyAdminSectionHref } from '@/lib/admin/navigation';
import { adminInsightPeriod } from '@/lib/admin/home-summary';
import { loadAdminHomeSummary } from '@/lib/admin/home-summary.server';
import { hasAdminCapability, operatorAccessOf } from '@/lib/admin/access';
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
  const [insights, moderation, workQueue, summary, attention] = await Promise.all([
    getAdminInsights(days).catch(() => null),
    getAdminModerationRecords().catch(() => null),
    loadAdminWorkQueue(),
    loadAdminHomeSummary().catch(() => undefined),
    loadAdminHomeAttention().catch(() => undefined),
  ]);

  return <OverviewSection insights={insights} reports={moderation?.reports ?? null} workQueue={workQueue} summary={summary} days={days} attention={attention} />;
}
