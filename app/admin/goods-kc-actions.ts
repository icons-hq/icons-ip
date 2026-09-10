'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { parseAdminGoodsKc, parseGoodsKcSaveInput, type AdminGoodsKc } from '@/lib/admin/goods-kc';

type Failure = { ok: false; error: string };
const STAFF_REQUIRED = 'KC 검토는 운영자만 조회하고 저장할 수 있습니다.';
function goodId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null;
}
function saveError(message: string): string {
  if (message === 'goods_kc_review_changed') return '상품·옵션 또는 KC 검토가 변경되었습니다. 입력 내용을 확인하고 저장된 정보를 다시 불러와주세요.';
  if (message === 'goods_kc_published_edit_requires_draft' || message === 'goods_kc_reassessment_required') {
    return 'KC 정보를 변경하려면 상품을 먼저 비공개로 전환해주세요.';
  }
  if (message === 'goods_kc_review_incomplete' || message === 'goods_kc_attestation_required') {
    return '모델별 필수 정보·원본 증빙·적용 옵션을 확인한 뒤 검토를 완료해주세요.';
  }
  if (message === 'catalog_item_archived') return '보관된 상품은 복원한 뒤 KC 정보를 수정할 수 있습니다.';
  return 'KC 정보를 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.';
}

export async function readGoodsKcAction(goodIdValue: unknown): Promise<{ ok: true; configuration: AdminGoodsKc } | Failure> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: STAFF_REQUIRED };
    const id = goodId(goodIdValue);
    if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_goods_kc', { p_good_id: id });
    const configuration = error ? null : parseAdminGoodsKc(data);
    return configuration ? { ok: true, configuration } : { ok: false, error: 'KC 검토를 불러오지 못했습니다. 다시 시도해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'KC 검토를 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

export async function saveGoodsKcAction(goodIdValue: unknown, inputValue: unknown): Promise<{
  ok: true; message: string; configuration: AdminGoodsKc;
} | Failure> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: STAFF_REQUIRED };
    const id = goodId(goodIdValue);
    const input = parseGoodsKcSaveInput(inputValue);
    if (!id || !input) return { ok: false, error: 'KC 입력 형식과 모델별 필수 정보·근거를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_kc', {
      p_good_id: id, p_models: input.models, p_status: input.status, p_expected_revision: input.expectedRevision,
      p_expected_context_fingerprint: input.expectedContextFingerprint, p_attested: input.attested,
    });
    if (error) return { ok: false, error: saveError(error.message) };
    const configuration = data && typeof data.changed === 'boolean' ? parseAdminGoodsKc(data.configuration) : null;
    if (!configuration) return { ok: false, error: 'KC 저장 결과를 확인하지 못했습니다. 저장된 정보를 다시 불러와주세요.' };
    revalidatePath('/admin/catalog/goods');
    revalidatePath(`/shop/${encodeURIComponent(id)}`);
    return { ok: true, configuration, message: input.status === 'reviewed'
      ? '대상 모델·옵션과 근거를 결속해 KC 검토를 완료했습니다. 상품 공개는 별도로 진행해주세요.'
      : 'KC 정보를 미검토 상태로 저장했습니다. 필수 정보와 실제 증빙을 확인한 뒤 검토를 완료해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'KC 정보를 저장하지 못했습니다. 입력은 유지되므로 다시 확인해주세요.' };
  }
}
