'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { getAdminCustomerDetail } from '@/lib/admin/customer-detail.server';
import { isCustomerId, MAX_CUSTOMER_NOTE_LENGTH, normalizeCustomerDetailFilters, type AdminCustomerDetail } from '@/lib/admin/customer-detail';

export interface CustomerNoteState { error?: string; message?: string; resultKey?: string }
export interface CustomerHistoryState {
  error?: string;
  history?: Pick<AdminCustomerDetail, 'items' | 'tab' | 'page' | 'pageSize' | 'total'> & { userId: string };
}
const NOTE_FAILED = '메모를 저장하지 못했습니다. 입력한 메모는 유지됩니다. 다시 시도해주세요.';
function read(data: FormData, name: string) { const value = data.get(name); return typeof value === 'string' ? value.trim() : ''; }
async function staffError(userId: string) {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(isCustomerId(userId) ? `/admin/customers/${userId}` : '/admin/community/members')}`);
  return auth.isStaff ? null : '운영자 권한이 필요합니다.';
}

export async function loadCustomerHistoryAction(_state: CustomerHistoryState, form: FormData): Promise<CustomerHistoryState> {
  const userId = read(form, 'userId');
  const accessError = await staffError(userId);
  if (accessError) return { error: accessError };
  const filters = normalizeCustomerDetailFilters({ tab: read(form, 'tab'), page: read(form, 'page') });
  if (!isCustomerId(userId) || !['orders', 'claims'].includes(filters.tab)) return { error: '고객 이력을 다시 열어주세요.' };
  try {
    const detail = await getAdminCustomerDetail(userId, filters);
    if (!detail) return { error: '고객을 찾을 수 없습니다.' };
    const { items, tab, page, pageSize, total } = detail;
    return { history: { userId, items, tab, page, pageSize, total } };
  } catch {
    return { error: '고객 이력을 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

export async function addCustomerNoteAction(_state: CustomerNoteState, form: FormData): Promise<CustomerNoteState> {
  const userId = read(form, 'userId');
  const accessError = await staffError(userId);
  if (accessError) return { error: accessError };
  const body = read(form, 'body');
  const operationId = read(form, 'operationId');
  if (!isCustomerId(userId) || !isCustomerId(operationId)) return { error: '고객 화면을 새로 열어 다시 시도해주세요.' };
  if (!body || [...body].length > MAX_CUSTOMER_NOTE_LENGTH) return { error: '메모를 1자 이상 2,000자 이하로 입력해주세요.' };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_add_customer_note', {
      target_user_id: userId, target_body: body, operation_id: operationId,
    });
    if (error || typeof data !== 'boolean') return { error: error?.message.includes('customer_not_found') ? '고객을 찾을 수 없습니다.' : NOTE_FAILED };
  } catch {
    return { error: NOTE_FAILED };
  }
  revalidatePath(`/admin/customers/${userId}`);
  return { message: '내부 메모를 저장했습니다.', resultKey: crypto.randomUUID() };
}
