import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { RETURN_ADDRESS_GOODS_SHOWN, parseReturnAddressRows, type ReturnAddress, type ReturnAddressGood, type ReturnAddressOption } from './return-addresses';

/**
 * 주소록 전체와 주소마다 그 주소를 고른 상품(수와 앞의 몇 개). 표 읽기는 RLS(catalog.read)가 정한다.
 * 보관한 상품도 센다 — 상품이 고른 주소는 보관한 상품이어도 지울 수 없다(`goods.return_address_id`가 지우기를 막는다).
 * 상품은 한 번에 읽는다. 그런데 API가 한 번에 돌려주는 줄 수에는 서버 설정의 상한(max_rows 1,000)이 있어, 반품/교환지를 고른 상품이 그보다 많으면
 * 줄이 모자란 채 세게 된다 — 0개로 세어진 주소에 [삭제]가 열리면 안 되므로, 받은 줄 수가 전체 수와 다르면 주소마다 정확히 다시 센다.
 */
export async function loadAdminReturnAddresses(): Promise<ReturnAddress[]> {
  const client = await createClient();
  const [addresses, goods] = await Promise.all([
    client.from('return_addresses').select('id,name,address,phone,updated_at').order('name'),
    client.from('goods').select('id,name,archived_at,return_address_id', { count: 'exact' }).not('return_address_id', 'is', null).order('name').limit(10000),
  ]);
  const failed = () => new Error('반품/교환지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (addresses.error || goods.error) throw failed();
  const base = parseReturnAddressRows(addresses.data);
  if (!base) throw failed();
  const counts = new Map<string, number>();
  const listed = new Map<string, ReturnAddressGood[]>();
  const good = (row: { id?: unknown; name?: unknown; archived_at?: unknown }): ReturnAddressGood[] =>
    typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name, archived: row.archived_at != null }] : [];
  const rows = (goods.data ?? []) as { id: unknown; name: unknown; archived_at: unknown; return_address_id: string | null }[];
  if (goods.count === rows.length) {
    for (const row of rows) {
      const addressId = row.return_address_id;
      if (!addressId) continue;
      counts.set(addressId, (counts.get(addressId) ?? 0) + 1);
      const shown = listed.get(addressId) ?? [];
      if (shown.length < RETURN_ADDRESS_GOODS_SHOWN) shown.push(...good(row));
      listed.set(addressId, shown);
    }
  } else {
    /* 줄이 모자란다(또는 전체 수를 받지 못했다). 주소마다 전체 수와 앞의 몇 개를 읽는다. */
    const exact = await Promise.all(base.map(async ({ id }) => {
      const result = await client.from('goods').select('id,name,archived_at', { count: 'exact' }).eq('return_address_id', id).order('name').limit(RETURN_ADDRESS_GOODS_SHOWN);
      return { id, ...result };
    }));
    for (const { id, data, count, error } of exact) {
      if (error || typeof count !== 'number') throw failed();
      counts.set(id, count);
      listed.set(id, ((data ?? []) as { id?: unknown; name?: unknown; archived_at?: unknown }[]).flatMap(good));
    }
  }
  const parsed = parseReturnAddressRows(addresses.data, counts, listed);
  if (!parsed) throw failed();
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
