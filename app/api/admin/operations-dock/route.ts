import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminAlertCategory, adminAlertFilterState } from '@/lib/admin/operations-dock';
import { getAdminOperationAlerts, getAdminOperationTasks } from '@/lib/admin/operations-dock.server';
import { searchAdminOperationHelp } from '@/lib/admin/operations-help.server';

export async function GET(request: Request) {
  const auth = await requireAdminScreenAccess('/admin');
  const params = new URL(request.url).searchParams;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const section = params.get('section') ?? 'alerts';
    if (section === 'help') return Response.json(searchAdminOperationHelp(params.get('q') ?? '', params.get('path') ?? '/admin', auth), { headers });
    if (section === 'tasks') return Response.json(await getAdminOperationTasks(), { headers });
    if (section !== 'alerts') return Response.json({ error: '지원하지 않는 업무 도구입니다.' }, { status: 400, headers });
    const before = params.get('before') || undefined;
    const beforeId = params.get('beforeId') || undefined;
    if (Boolean(before) !== Boolean(beforeId) || (before && !Number.isFinite(Date.parse(before))) || (beforeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(beforeId))) return Response.json({ error: '알림 조회 위치를 확인해주세요.' }, { status: 400, headers });
    return Response.json(await getAdminOperationAlerts(adminAlertCategory(params.get('category')), adminAlertFilterState(params.get('state')), before, beforeId), { headers });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: '업무 정보를 불러오지 못했습니다. 새로고침해주세요.' }, { status: 500, headers });
  }
}
