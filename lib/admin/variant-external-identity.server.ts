import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { GoodsVariantExternalIdentity } from './variant-external-identity';

export type AdminGoodsVariantExternalIdentity = GoodsVariantExternalIdentity & {
  variantId: string;
  goodId: string;
};

type RpcRow = {
  variant_id: unknown;
  good_id: unknown;
  erp_code: unknown;
  erp_name: unknown;
  barcode: unknown;
  updated_at: unknown;
};

function readText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function loadAdminGoodsVariantExternalIdentities(goodId: string): Promise<AdminGoodsVariantExternalIdentity[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_goods_variant_external_identities', { target_good_id: goodId });
  if (error) throw new Error('옵션 ERP 식별자를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return ((data ?? []) as RpcRow[]).flatMap((row) => {
    if (typeof row.variant_id !== 'string' || typeof row.good_id !== 'string') return [];
    return [{
      variantId: row.variant_id,
      goodId: row.good_id,
      erpCode: readText(row.erp_code),
      erpName: readText(row.erp_name),
      barcode: readText(row.barcode),
      updatedAt: readText(row.updated_at),
    }];
  });
}
