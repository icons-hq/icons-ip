'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseAdminGoodsKc, parseGoodsKcSaveInput, type AdminGoodsKc } from '@/lib/admin/goods-kc';
import {
  goodsOtherCertificationsSaveError, parseAdminGoodsOtherCertifications, parseGoodsOtherCertificationsSaveInput,
  type AdminGoodsOtherCertifications,
} from '@/lib/admin/goods-kc-other-certifications';

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
    return '사용 중인 옵션 연결과, KC 대상이면 제품군·제도·품목·모델·사업자와 인증·신고번호(안전인증·안전확인)를 확인한 뒤 검토를 완료해주세요.';
  }
  if (message === 'catalog_item_archived') return '보관된 상품은 복원한 뒤 KC 정보를 수정할 수 있습니다.';
  return 'KC 정보를 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.';
}

export async function readGoodsKcAction(goodIdValue: unknown): Promise<{ ok: true; configuration: AdminGoodsKc } | Failure> {
  try {
    const auth = await requireAdminActionAccess('/admin/catalog/goods');
    if (!auth) return { ok: false, error: STAFF_REQUIRED };
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
    const auth = await requireAdminActionAccess('/admin/catalog/goods');
    if (!auth) return { ok: false, error: STAFF_REQUIRED };
    const id = goodId(goodIdValue);
    const input = parseGoodsKcSaveInput(inputValue);
    if (!id || !input) return { ok: false, error: 'KC 입력 형식과 모델별 필수 정보를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_kc', {
      p_good_id: id, p_models: input.models, p_status: input.status, p_expected_revision: input.expectedRevision,
      p_expected_context_fingerprint: input.expectedContextFingerprint, p_attested: input.attested,
    });
    if (error) return { ok: false, error: saveError(error.message) };
    const configuration = data && typeof data.changed === 'boolean' ? parseAdminGoodsKc(data.configuration) : null;
    if (!configuration) return { ok: false, error: 'KC 저장 결과를 확인하지 못했습니다. 저장된 정보를 다시 불러와주세요.' };
    revalidateGoodsSurfaces();
    return { ok: true, configuration, message: input.status === 'reviewed'
      ? 'KC 검토를 완료했습니다. 상품 공개는 게시 상태에서 별도로 진행해주세요.'
      : 'KC 정보를 미검토 상태로 저장했습니다. 필수 정보를 확인한 뒤 확인을 체크해 검토를 완료해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: 'KC 정보를 저장하지 못했습니다. 입력은 유지되므로 다시 확인해주세요.' };
  }
}

const OTHER_STAFF_REQUIRED = '기타 인증은 운영자만 조회하고 저장할 수 있습니다.';

/** 기타 인증(SHEET-014·ADR-0036) 조회. 공개 조건이 아니라 KC 검토와 따로 읽는다. */
export async function readGoodsOtherCertificationsAction(goodIdValue: unknown): Promise<{ ok: true; configuration: AdminGoodsOtherCertifications } | Failure> {
  try {
    const auth = await requireAdminActionAccess('/admin/catalog/goods');
    if (!auth) return { ok: false, error: OTHER_STAFF_REQUIRED };
    const id = goodId(goodIdValue);
    if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_goods_other_certifications', { p_good_id: id });
    const configuration = error ? null : parseAdminGoodsOtherCertifications(data);
    return configuration ? { ok: true, configuration } : { ok: false, error: '기타 인증을 불러오지 못했습니다. 다시 시도해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '기타 인증을 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

/** 기타 인증 저장. 버전이 다르면 서버가 거절하고, 고객 표시 목록은 DB가 노출 항목으로 다시 만든다. */
export async function saveGoodsOtherCertificationsAction(goodIdValue: unknown, inputValue: unknown): Promise<{
  ok: true; message: string; configuration: AdminGoodsOtherCertifications;
} | Failure> {
  try {
    const auth = await requireAdminActionAccess('/admin/catalog/goods');
    if (!auth) return { ok: false, error: OTHER_STAFF_REQUIRED };
    const id = goodId(goodIdValue);
    const input = parseGoodsOtherCertificationsSaveInput(inputValue);
    if (!id || !input) return { ok: false, error: '기타 인증마다 인증 종류와 인증번호를 확인해주세요. 같은 인증은 한 번만 입력합니다.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_other_certifications', {
      p_good_id: id, p_entries: input.entries, p_expected_revision: input.expectedRevision,
    });
    if (error) return { ok: false, error: goodsOtherCertificationsSaveError(error.message) };
    const configuration = data && typeof data.changed === 'boolean' ? parseAdminGoodsOtherCertifications(data.configuration) : null;
    if (!configuration) return { ok: false, error: '기타 인증 저장 결과를 확인하지 못했습니다. 저장된 정보를 다시 불러와주세요.' };
    if (data.changed) revalidateGoodsSurfaces();
    const visible = configuration.entries.filter((entry) => entry.visible).length;
    return { ok: true, configuration, message: data.changed
      ? `기타 인증 ${configuration.entries.length}건을 저장했습니다. 고객 상세에는 ${visible}건이 보입니다.`
      : '바뀐 내용이 없어 저장된 기타 인증을 그대로 두었습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '기타 인증을 저장하지 못했습니다. 입력은 유지되므로 다시 시도해주세요.' };
  }
}
