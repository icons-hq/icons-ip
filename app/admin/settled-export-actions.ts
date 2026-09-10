'use server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { isSettledExportId, parseSettledExportFilters, settledExportErrorMessage, type SettledExportReceipt } from '@/lib/admin/settled-export';

export interface SettledExportActionState { error?: string; receipt?: SettledExportReceipt; requestId?: string }
export async function createSettledExportAction(_previous: SettledExportActionState, form: FormData): Promise<SettledExportActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) return { error: '운영자 권한이 필요합니다.' };
  const values: Record<string, unknown> = {};
  for (const key of ['from', 'to', 'query', 'requestId']) {
    const all = form.getAll(key); if (all.length > 1 || (all.length && typeof all[0] !== 'string')) return { error: '조회 조건을 확인해주세요.' };
    values[key] = all[0] ?? '';
  }
  const filters = parseSettledExportFilters(values); const requestId = values.requestId as string;
  if (!filters || !isSettledExportId(requestId)) return { error: '조회 조건을 확인한 뒤 목록을 다시 열어주세요.' };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_create_settled_export', { p_request_id: requestId, p_filters: filters });
    if (error) return { error: settledExportErrorMessage(error.message) };
    const receipt = data as SettledExportReceipt | null;
    if (!receipt || !isSettledExportId(receipt.id) || !Number.isFinite(Date.parse(receipt.capturedAt)) || !Number.isSafeInteger(receipt.orderCount) || receipt.orderCount < 1) return { error: settledExportErrorMessage() };
    return { receipt, requestId: crypto.randomUUID() };
  } catch { return { error: settledExportErrorMessage() }; }
}
