'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import {
  parseAdditionalGoodCandidates, parseAdditionalGoodIds, parseAdminAdditionalGoods,
  type AdminAdditionalGood, type AdminAdditionalGoods,
} from '@/lib/admin/goods-additional';

type Failure = { ok: false; error: string };
const STAFF_REQUIRED = '추가상품 설정은 운영자만 변경할 수 있습니다.';
async function isStaff() {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && Boolean(auth.user) && auth.isStaff;
}
function goodId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 200 ? id : null;
}
export async function readGoodsAdditionalAction(goodIdValue: unknown): Promise<{ ok: true; configuration: AdminAdditionalGoods } | Failure> {
  if (!await isStaff()) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_goods_additional', { p_good_id: id });
    const configuration = error ? null : parseAdminAdditionalGoods(data);
    return configuration ? { ok: true, configuration } : { ok: false, error: '추가상품 설정을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '추가상품 설정을 불러오지 못했습니다.' }; }
}
export async function searchGoodsAdditionalAction(goodIdValue: unknown, queryValue: unknown): Promise<{ ok: true; items: AdminAdditionalGood[] } | Failure> {
  if (!await isStaff()) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  const query = typeof queryValue === 'string' ? queryValue.trim() : '';
  if (!id || !query || query.length > 100) return { ok: false, error: '검색할 상품명이나 상품코드를 입력해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_search_goods_additional', { p_base_good_id: id, p_query: query });
    const items = error ? null : parseAdditionalGoodCandidates(data);
    return items ? { ok: true, items } : { ok: false, error: '추가상품을 검색하지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '추가상품을 검색하지 못했습니다.' }; }
}
export async function saveGoodsAdditionalAction(goodIdValue: unknown, idsValue: unknown, revisionValue: unknown): Promise<{ ok: true; message: string } | Failure> {
  if (!await isStaff()) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  const ids = parseAdditionalGoodIds(idsValue);
  const revisionValid = revisionValue === null || (typeof revisionValue === 'number' && Number.isInteger(revisionValue)
    && revisionValue >= 1 && revisionValue <= 2147483647);
  if (!id || !ids || ids.includes(id) || !revisionValid) return { ok: false, error: '추가상품과 저장된 설정을 다시 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_additional', {
      p_good_id: id, p_target_good_ids: ids, p_expected_revision: revisionValue,
    });
    if (error) return { ok: false, error: error.message === 'additional_goods_changed'
      ? '추가상품 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해주세요.'
      : error.message === 'additional_goods_cycle' ? '상품이 서로 순환하여 연결될 수 없습니다. 연결 관계를 확인해주세요.'
        : error.message === 'additional_good_unavailable' ? '현재 판매 중인 상품만 새로 연결할 수 있습니다. 상품 상태를 확인해주세요.'
          : '추가상품을 저장하지 못했습니다.' };
    if (!data || typeof data.changed !== 'boolean') return { ok: false, error: '추가상품 저장 결과를 확인하지 못했습니다. 설정을 새로고침해주세요.' };
    revalidatePath('/admin/catalog/goods'); revalidatePath(`/shop/${encodeURIComponent(id)}`);
    return { ok: true, message: ids.length ? '추가상품 연결과 표시 순서를 저장했습니다.' : '추가상품 연결을 모두 해제했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '추가상품을 저장하지 못했습니다.' }; }
}
