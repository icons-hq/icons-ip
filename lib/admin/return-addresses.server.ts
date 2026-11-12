import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseReturnAddressRows, type ReturnAddress, type ReturnAddressOption } from './return-addresses';

/** 주소록 전체와 주소마다 그 주소를 고른 상품 수. 표 읽기는 RLS(catalog.read)가 정한다. */
export async function loadAdminReturnAddresses(): Promise<ReturnAddress[]> {
  const client = await createClient();
  const [addresses, goods] = await Promise.all([
    client.from('return_addresses').select('id,name,address,phone,updated_at').order('name'),
    client.from('goods').select('return_address_id').not('return_address_id', 'is', null).limit(10000),
  ]);
  if (addresses.error || goods.error) throw new Error('반품/교환지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const counts = new Map<string, number>();
  for (const row of goods.data ?? []) {
    const id = (row as { return_address_id: string | null }).return_address_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const parsed = parseReturnAddressRows(addresses.data, counts);
  if (!parsed) throw new Error('반품/교환지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return parsed;
}

/** 상품 편집기의 반품/교환지 선택지. */
export async function loadGoodsReturnAddressOptions(): Promise<ReturnAddressOption[]> {
  const client = await createClient();
  const { data, error } = await client.from('return_addresses').select('id,name,address,phone,updated_at').order('name');
  const parsed = error ? null : parseReturnAddressRows(data);
  if (!parsed) throw new Error('상품 반품/교환지 선택지를 불러오지 못했습니다.');
  return parsed.map(({ id, name, address }) => ({ id, name, address }));
}
