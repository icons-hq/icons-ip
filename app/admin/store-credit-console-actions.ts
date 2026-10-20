'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { kstDateTimeToIso } from '@/lib/admin/kst';
import { normalizeStoreCreditAmount } from '@/lib/store-credits';
import { parseStoreCreditBatch, parseStoreCreditTargets, STORE_CREDIT_CONSOLE_PATH, storeCreditBatchError, type StoreCreditBatch, type StoreCreditCustomer } from '@/lib/admin/store-credit-console';
import { readStoreCreditTargetsFile, STORE_CREDIT_FILE_BYTES } from '@/lib/admin/store-credit-target-file.server';
export type StoreCreditBatchActionResult = { batch: StoreCreditBatch; error?: never } | { error: string; batch?: never };
async function access() { return requireAdminActionAccess(STORE_CREDIT_CONSOLE_PATH,{ adminOnly: true }); }
function text(form: FormData,key: string) { const value = form.get(key); return typeof value === 'string' ? value.trim() : ''; }
export async function findStoreCreditCustomersAction(query: string): Promise<{ customers: StoreCreditCustomer[]; error?: never } | { error: string; customers?: never }> {
  if (!await access()) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) return { error: '고객 이름·ID·정확한 이메일을 2자 이상 입력해주세요.' };
  try {
    const client = await createClient(); const { data,error } = await client.rpc('admin_find_store_credit_customers',{ p_query: query.trim() });
    if (error || !Array.isArray(data) || data.some(item => !item || !isUuid(item.id) || typeof item.nickname !== 'string' || typeof item.maskedEmail !== 'string' || typeof item.eligible !== 'boolean')) return { error: '고객을 불러오지 못했습니다.' };
    return { customers: data };
  } catch (error) { unstable_rethrow(error); return { error: '고객을 불러오지 못했습니다.' }; }
}
export async function importStoreCreditTargetsAction(form: FormData): Promise<{ targets: string[]; duplicates: number; error?: never } | { error: string; targets?: never }> {
  if (!await access()) return { error: '관리자 권한이 필요합니다.' };
  const file = form.get('file');
  if (!file || typeof file === 'string' || file.size > STORE_CREDIT_FILE_BYTES) return { error: '500KB 이하의 XLSX 또는 CSV 파일을 선택해주세요.' };
  try { return await readStoreCreditTargetsFile(file.name,Buffer.from(await file.arrayBuffer())); }
  catch (error) { unstable_rethrow(error); return { error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' }; }
}
export async function previewStoreCreditBatchAction(form: FormData): Promise<StoreCreditBatchActionResult> {
  if (!await access()) return { error: '관리자 권한이 필요합니다.' };
  const id = text(form,'id'); const amount = normalizeStoreCreditAmount(text(form,'amount')); const errors: Record<string,string> = {};
  const expiresAt = kstDateTimeToIso(form,'expiresAt',errors); const reason = text(form,'reason'); const purpose = text(form,'purpose');
  if (!isUuid(id) || amount === null || amount < 1 || !expiresAt || Object.keys(errors).length || !reason || reason.length > 1000 || !['promotion','general'].includes(purpose)
    || new Date(Date.parse(expiresAt) + 9*3600000).toISOString().slice(0,16) !== text(form,'expiresAt')) return { error: '지급 금액·사유·미래 만료 일시(KST)를 확인해주세요.' };
  let targets: string[];
  try { targets = parseStoreCreditTargets(text(form,'targets')).targets; } catch (error) { return { error: error instanceof Error ? error.message : '지급 대상을 확인해주세요.' }; }
  try {
    const client = await createClient(); const { data,error } = await client.rpc('admin_preview_store_credit_batch',{ p_id: id,p_targets: targets,p_amount: amount,p_expires_at: expiresAt,p_reason: reason,p_purpose: purpose });
    const batch = error ? null : parseStoreCreditBatch(data);
    return batch?.id === id ? { batch } : { error: storeCreditBatchError(error?.message ?? null) };
  } catch (error) { unstable_rethrow(error); return { error: '대상을 검증하지 못했습니다. 입력 내용을 유지합니다.' }; }
}
export async function executeStoreCreditBatchAction(form: FormData): Promise<StoreCreditBatchActionResult> {
  if (!await access()) return { error: '관리자 권한이 필요합니다.' };
  const id = text(form,'id');
  if (!isUuid(id) || text(form,'confirmed') !== 'yes') return { error: '확인된 대상 수와 총액을 확인해주세요.' };
  try {
    const client = await createClient(); const { data,error } = await client.rpc('admin_execute_store_credit_batch',{ p_id: id });
    if (error || parseStoreCreditBatch(data)?.id !== id) return { error: '실행 결과를 확인하지 못했습니다. 같은 작업의 결과 조회 또는 재시도로 확인해주세요.' };
    const readback = await client.rpc('admin_get_store_credit_batch',{ p_id: id });
    const batch = readback.error ? null : parseStoreCreditBatch(readback.data);
    if (!batch || batch.id !== id) return { error: '실행 응답 후 저장된 결과를 다시 읽지 못했습니다. 결과 조회로 확인해주세요.' };
    revalidatePath(STORE_CREDIT_CONSOLE_PATH); revalidatePath('/admin/customers/[userId]/store-credits','page'); revalidatePath('/my/store-credits'); revalidatePath('/checkout');
    return { batch };
  } catch (error) { unstable_rethrow(error); return { error: '지급 결과가 아직 확인되지 않았습니다. 같은 작업 ID로 결과를 조회하거나 재시도해주세요.' }; }
}
export async function readStoreCreditBatchAction(id: string): Promise<StoreCreditBatchActionResult> {
  if (!await access()) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(id)) return { error: '지급 작업 ID를 확인해주세요.' };
  try {
    const client = await createClient(); const { data,error } = await client.rpc('admin_get_store_credit_batch',{ p_id: id });
    const batch = error ? null : parseStoreCreditBatch(data);
    return batch?.id === id ? { batch } : { error: '지급 작업 결과를 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { error: '지급 작업 결과를 불러오지 못했습니다.' }; }
}
