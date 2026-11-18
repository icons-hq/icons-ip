import { PiiAccessLogScreen } from '@/components/admin/screens/PiiAccessLogScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { PII_ACCESS_LOG_PATH, normalizePiiAccessLogFilters } from '@/lib/admin/pii-access-log';
import { loadPiiAccessLog, recordPiiAccess } from '@/lib/admin/pii-access-log.server';

/*
 * 개인정보 접속기록 점검(CUS-084·OPS-014). 매니저 관리 권한(통합·주매니저, 호환 단계 admin)만 열고, DB도 같은 권한을 다시 판정한다.
 * 운영자 IP와 열람 대상을 모아 보여 주는 화면이라 이 화면의 열람 기록이 남아야 연다(기록 실패 = 화면 오류).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(PII_ACCESS_LOG_PATH);
  const filters = normalizePiiAccessLogFilters(await searchParams);
  const data = await loadPiiAccessLog(filters);
  await recordPiiAccess({ actorId: auth.user.id, action: 'view', surface: 'access_log', path: PII_ACCESS_LOG_PATH, subjectKind: 'none',
    detail: { from: filters.from, to: filters.to, page: data.page, actorFiltered: Boolean(filters.actor), subjectFiltered: Boolean(filters.subject),
      action: filters.action, surface: filters.surface, flag: filters.flag } });
  return <PiiAccessLogScreen data={data} filters={filters} />;
}
