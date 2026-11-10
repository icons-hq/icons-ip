import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsEditorOwnership, parseGoodsGroupCommonSnapshot } from './goods-group-common';

export async function loadGoodsEditorOwnership(goodId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_goods_group_editor_ownership', { p_good_id: goodId });
  const value = error ? null : parseGoodsEditorOwnership(data);
  if (!value || value.goodId !== goodId) throw new Error('상품의 그룹·합산 설정을 확인하지 못했습니다. 화면을 다시 열어주세요.');
  return value;
}
export async function loadGoodsGroupCommon(groupId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_goods_group_common', { p_group_id: groupId });
  if (!error && data === null) return null;
  const value = error ? null : parseGoodsGroupCommonSnapshot(data);
  if (!value || value.group.id !== groupId) throw new Error('그룹 공통정보의 현재 저장값을 확인하지 못했습니다.');
  return value;
}
