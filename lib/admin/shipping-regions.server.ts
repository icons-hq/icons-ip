import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseShippingRegionPolicy, type ShippingRegionPolicy } from './shipping-regions';

export interface ShippingRegionAdoption { originId: string; managedFrom: string }
export async function loadAdminShippingRegionPolicies(): Promise<{ policies: ShippingRegionPolicy[]; adoptions: ShippingRegionAdoption[] }> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_shipping_region_policies');
  if (error || !data || !Array.isArray(data.policies) || !Array.isArray(data.adoptions)) throw new Error('지역 배송 정책을 불러오지 못했습니다.');
  const policies = data.policies.map(parseShippingRegionPolicy);
  if (policies.some((policy: ShippingRegionPolicy | null) => !policy) || data.adoptions.some((row: ShippingRegionAdoption) =>
    !row || typeof row.originId !== 'string' || typeof row.managedFrom !== 'string' || !Number.isFinite(Date.parse(row.managedFrom)))) {
    throw new Error('지역 배송 정책의 저장 결과를 확인하지 못했습니다.');
  }
  return { policies: policies as ShippingRegionPolicy[], adoptions: data.adoptions };
}
