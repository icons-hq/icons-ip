'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { isMarketingLinkSource, marketingSourceCapability, validMarketingTarget, parseMarketingLinkRows, MARKETING_LINKS_PATH, MARKETING_LINK_ORIGINS, type MarketingLinkSource, type IssueMarketingLinksResult } from '@/lib/admin/marketing-links';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
const uncertain = (): IssueMarketingLinksResult => ({ error: '링크 생성 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
export async function issueMarketingLinksAction(source: MarketingLinkSource, targetIds: string[], operationId: string): Promise<IssueMarketingLinksResult> {
  try {
    if (!isMarketingLinkSource(source)) return { error: '링크 대상을 확인해주세요.' };
    // Home issue uses the store surface guard: a ledger reader alone cannot issue.
    const path = source === 'home' ? '/admin/display/curations' : MARKETING_LINK_ORIGINS[source];
    const auth = await requireAdminActionAccess(path, { capability: marketingSourceCapability(source) });
    if (!auth) return { error: '이 대상의 마케팅 링크 생성 권한이 없습니다.' };
    if (!isUuid(operationId) || !Array.isArray(targetIds) || targetIds.length < 1 || targetIds.length > 100 || new Set(targetIds).size !== targetIds.length
      || targetIds.some(id => !validMarketingTarget(source, id)) || (source === 'home' && targetIds.length !== 1)) return { error: '한 번에 1개부터 100개까지 선택해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_issue_marketing_links', { p_source: source, p_target_ids: targetIds, p_operation_id: operationId });
    if (error) {
      if (['22023', '23505', '42501', 'P0002'].includes(error.code ?? '')) return { error: error.message === 'marketing_target_missing' ? '삭제되었거나 찾을 수 없는 대상이 있습니다. 목록을 새로고침해주세요.' : '현재 권한과 선택 대상을 확인한 뒤 다시 시도해주세요.' };
      return uncertain();
    }
    const rows = parseMarketingLinkRows(data?.rows);
    if (!rows || rows.length !== targetIds.length || rows.some(row => row.source !== source)) return uncertain();
    revalidatePath(MARKETING_LINKS_PATH);
    return { rows };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
