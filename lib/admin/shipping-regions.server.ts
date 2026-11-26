import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseShippingRegionPolicy, shippingRegionExpiryWarnings, type ShippingRegionAdoption, type ShippingRegionPolicy, type ShippingRegionExpiryPolicy, type ShippingRegionExpiryState } from './shipping-regions';
import { unstable_rethrow } from 'next/navigation';

export type { ShippingRegionAdoption } from './shipping-regions';
export async function loadAdminShippingRegionPolicies(): Promise<{ policies: ShippingRegionPolicy[]; adoptions: ShippingRegionAdoption[] }> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_shipping_region_policies');
  if (error || !data || !Array.isArray(data.policies) || !Array.isArray(data.adoptions)) throw new Error('지역별 추가배송비를 불러오지 못했습니다.');
  const policies = data.policies.map(parseShippingRegionPolicy);
  if (policies.some((policy: ShippingRegionPolicy | null) => !policy) || data.adoptions.some((row: ShippingRegionAdoption) =>
    !row || typeof row.originId !== 'string' || typeof row.managedFrom !== 'string' || !Number.isFinite(Date.parse(row.managedFrom)))) {
    throw new Error('지역별 추가배송비를 읽지 못했습니다. 저장된 값의 형식이 맞지 않습니다.');
  }
  return { policies: policies as ShippingRegionPolicy[], adoptions: data.adoptions };
}

export async function loadAdminShippingRegionExpiry(): Promise<ShippingRegionExpiryState> {
  try {
    const client=await createClient();
    const now=Date.now();
    const {data,error}=await client.rpc('admin_shipping_region_expiry_metadata',{p_at:new Date(now).toISOString()});
    if (error || !Array.isArray(data) || data.some((row)=>!row || typeof row!=='object'
      || !['id','name','originId','originName','carrierCode','carrierLabel'].every(key=>typeof row[key]==='string')
      || row.status!=='active' || !Number.isSafeInteger(row.version) || row.version<1
      || typeof row.startsAt!=='string' || !Number.isFinite(Date.parse(row.startsAt))
      || typeof row.endsAt!=='string' || !Number.isFinite(Date.parse(row.endsAt)))) throw new Error('Invalid expiry metadata');
    const rows = data as ShippingRegionExpiryPolicy[];
    const warnings = shippingRegionExpiryWarnings(rows, now);
    /*
     * 7일 안에 끝나는 설정이 있을 때만 전체 설정을 한 번 더 읽어, 끝나는 때에 바로 이어지는 '예정' 설정이 있는지 본다 — 만료 조회는 끝이 없거나 먼 설정을
     * 돌려주지 않아서, 이어지는 설정이 있어도 틈이 생기는 것처럼 보인다(나중 시작으로 적용하면 이전 설정의 끝이 새 시작에 맞춰진다).
     * 읽지 못하면 이어지는지 알 수 없으니 경고를 그대로 둔다.
     */
    if (!warnings.some((warning) => warning.status === 'expiring')) return { warnings };
    try {
      const { policies } = await loadAdminShippingRegionPolicies();
      return { warnings: shippingRegionExpiryWarnings(rows, now, policies) };
    } catch (error) {
      unstable_rethrow(error);
      return { warnings };
    }
  } catch (error) {
    unstable_rethrow(error);
    return { warnings: [], unavailable: true };
  }
}
