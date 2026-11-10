import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { OPERATOR_INVITATION_STATUSES, parseOperatorInvitations, type OperatorInvitationList } from './operator-invitations';

export function normalizeInvitationListFilters(input: Record<string, string | string[] | undefined>): Omit<OperatorInvitationList, 'rows' | 'total'> {
  const one = (name: string) => typeof input[name] === 'string' ? input[name] as string : '';
  const status = one('inviteStatus'); const page = Number(one('invitePage')); const pageSize = Number(one('invitePageSize'));
  return { query: one('inviteQuery').trim().slice(0, 100), status: OPERATOR_INVITATION_STATUSES.includes(status as typeof OPERATOR_INVITATION_STATUSES[number]) ? status as OperatorInvitationList['status'] : 'all',
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1, pageSize: pageSize === 50 || pageSize === 100 ? pageSize : 20 };
}
export async function loadOperatorInvitations(filters: Omit<OperatorInvitationList, 'rows' | 'total'>): Promise<OperatorInvitationList> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_operator_invitations', { p_query: filters.query, p_status: filters.status, p_page: filters.page, p_page_size: filters.pageSize });
  const parsed = parseOperatorInvitations(data);
  if (error || !parsed) throw new Error('매니저 초대 내역을 불러오지 못했습니다. 잠시 후 다시 조회해주세요.');
  if (!parsed.rows.length && filters.page > 1 && parsed.total > 0) return loadOperatorInvitations({ ...filters, page: Math.ceil(parsed.total / filters.pageSize) });
  return { ...parsed, ...filters };
}
