import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { RETURN_ADDRESS_GOODS_SHOWN, parseReturnAddressRows, type ReturnAddress, type ReturnAddressGood, type ReturnAddressOption } from './return-addresses';

/**
 * 주소록 전체와 주소마다 그 주소를 고른 상품(수와 앞의 몇 개). 표 읽기는 RLS(catalog.read)가 정한다.
 * 보관한 상품도 센다 — 상품이 고른 주소는 보관한 상품이어도 지울 수 없다(`goods.return_address_id`가 지우기를 막는다).
 */
export async function loadAdminReturnAddresses(): Promise<ReturnAddress[]> {
  const client = await createClient();
  const [addresses, goods] = await Promise.all([
    client.from('return_addresses').select('id,name,address,phone,updated_at').order('name'),
    client.from('goods').select('id,name,archived_at,return_address_id').not('return_address_id', 'is', null).order('name').limit(10000),
  ]);
  if (addresses.error || goods.error) throw new Error('반품/교환지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const counts = new Map<string, number>();
  const listed = new Map<string, ReturnAddressGood[]>();
  for (const row of goods.data ?? []) {
    const { id, name, archived_at: archivedAt, return_address_id: addressId } = row as { id: unknown; name: unknown; archived_at: unknown; return_address_id: string | null };
    if (!addressId) continue;
    counts.set(addressId, (counts.get(addressId) ?? 0) + 1);
    const shown = listed.get(addressId) ?? [];
    if (shown.length < RETURN_ADDRESS_GOODS_SHOWN && typeof id === 'string' && typeof name === 'string') shown.push({ id, name, archived: archivedAt != null });
    listed.set(addressId, shown);
  }
  const parsed = parseReturnAddressRows(addresses.data, counts, listed);
  if (!parsed) throw new Error('반품/교환지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return parsed;
}

/** 이 반품/교환지를 고른 상품 수. 읽지 못하면 null(저장 결과 문구가 수를 빼고 말한다). */
export async function countReturnAddressGoods(addressId: string): Promise<number | null> {
  const { count, error } = await (await createClient()).from('goods').select('id', { count: 'exact', head: true }).eq('return_address_id', addressId);
  return error || typeof count !== 'number' ? null : count;
}

/** 상품 편집기의 반품/교환지 선택지. */
export async function loadGoodsReturnAddressOptions(): Promise<ReturnAddressOption[]> {
  const client = await createClient();
  const { data, error } = await client.from('return_addresses').select('id,name,address,phone,updated_at').order('name');
  const parsed = error ? null : parseReturnAddressRows(data);
  if (!parsed) throw new Error('상품 반품/교환지 선택지를 불러오지 못했습니다.');
  return parsed.map(({ id, name, address }) => ({ id, name, address }));
}
