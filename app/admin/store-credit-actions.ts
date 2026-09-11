'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { kstDateTimeToIso } from '@/lib/admin/kst';
import { normalizeStoreCreditAmount, parseStoreCreditBalanceValues, parseStoreCreditPolicyInput, parseStoreCreditPolicyRecord, storeCreditErrorMessage, type StoreCreditPolicyRecord } from '@/lib/store-credits';

export interface StoreCreditActionState {
  error?: string; message?: string; values?: Record<string, string>; operationId?: string;
  policy?: StoreCreditPolicyRecord; available?: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function read(form: FormData, name: string) { const value = form.get(name); return typeof value === 'string' ? value.trim() : ''; }
function capture(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string' && !key.startsWith('$ACTION')).map(([key, value]) => [key, String(value)]));
}
async function adminAllowed() {
  const auth = await getCurrentAdminAuthState();
  return Boolean(auth.isConfigured && auth.user && auth.isStaff && auth.role === 'admin');
}
export async function saveStoreCreditPolicyAction(_state: StoreCreditActionState, form: FormData): Promise<StoreCreditActionState> {
  const values = capture(form);
  if (!await adminAllowed()) return { error: '관리자 권한이 필요합니다.', values };
  const parsed = parseStoreCreditPolicyInput(form);
  if (!parsed.ok) return { error: parsed.error, values };
  const operationId = read(form, 'operationId');
  const version = Number(read(form, 'version'));
  if (!UUID.test(operationId) || !Number.isSafeInteger(version) || version < 1) return { error: '정책 화면을 새로 열고 다시 저장해주세요.', values };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_save_store_credit_policy', { p_operation_id: operationId, p_expected_version: version, p_policy: parsed.policy });
    const saved = error ? null : parseStoreCreditPolicyRecord(data);
    if (!saved) return { error: storeCreditErrorMessage(error?.message ?? null), values };
    revalidatePath('/admin/settings/store-credits');
    revalidatePath('/my/store-credits');
    revalidatePath('/checkout');
    return { message: parsed.policy.enabled ? '적립금 정책을 저장하고 활성화했습니다.' : '적립금 정책을 비활성 상태로 저장했습니다.', policy: saved, operationId: crypto.randomUUID() };
  } catch { return { error: '정책을 저장하지 못했습니다. 입력은 유지됩니다.', values }; }
}

export async function adjustStoreCreditAction(_state: StoreCreditActionState, form: FormData): Promise<StoreCreditActionState> {
  const values = capture(form);
  if (!await adminAllowed()) return { error: '관리자 권한이 필요합니다.', values };
  const userId = read(form, 'userId'); const operationId = read(form, 'operationId');
  const amount = normalizeStoreCreditAmount(read(form, 'amount'));
  const expectedAvailable = normalizeStoreCreditAmount(read(form, 'expectedAvailable'));
  const direction = read(form, 'direction'); const reason = read(form, 'reason');
  const errors: Record<string, string> = {};
  const expiresAt = direction === 'credit' ? kstDateTimeToIso(form, 'expiresAt', errors) : null;
  if (expiresAt && new Date(Date.parse(expiresAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) !== read(form, 'expiresAt')) errors.expiresAt = '유효한 날짜를 입력해주세요.';
  if (!UUID.test(userId) || !UUID.test(operationId) || amount === null || amount === 0 || expectedAvailable === null
    || !['credit', 'debit'].includes(direction) || !reason || reason.length > 1000
    || Object.keys(errors).length || (direction === 'credit' && !expiresAt)) {
    return { error: '고객·조정 금액·사유를 확인하고, 지급 시 만료 일시(KST)를 입력해주세요.', values };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_adjust_store_credit', {
      p_operation_id: operationId, p_user_id: userId, p_amount: direction === 'credit' ? amount : -amount,
      p_expires_at: expiresAt, p_reason: reason, p_expected_available: expectedAvailable,
    });
    const saved = error ? null : parseStoreCreditBalanceValues(data);
    if (!saved) return { error: storeCreditErrorMessage(error?.message ?? null), values };
    revalidatePath(`/admin/customers/${userId}/store-credits`);
    revalidatePath('/my/store-credits');
    revalidatePath('/checkout');
    return { message: '적립금 조정을 저장했습니다.', available: saved.available, operationId: crypto.randomUUID() };
  } catch { return { error: '적립금 조정을 저장하지 못했습니다. 입력은 유지됩니다.', values }; }
}
