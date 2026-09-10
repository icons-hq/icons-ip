import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminGoodsVariant } from './goods-variants';

export async function loadAdminGoodsVariants(goodId?: string): Promise<AdminGoodsVariant[]> {
  const supabase = await createClient();
  const variants: AdminGoodsVariant[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('goods_variants')
      .select('id,code,good_id,name,attributes,price,stock_qty,low_stock_threshold,is_default,archived_at,updated_at')
      .order('good_id').order('sort_order').order('id');
    if (goodId) query = query.eq('good_id', goodId);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error('옵션 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    variants.push(...(data ?? []).map((row) => ({
      attributes: row.attributes, id: row.id, code: row.code, goodId: row.good_id, name: row.name, price: row.price,
      stockQty: row.stock_qty, lowStockThreshold: row.low_stock_threshold,
      isDefault: row.is_default, archivedAt: row.archived_at, updatedAt: row.updated_at,
    })));
    if (!data || data.length < pageSize) break;
  }

  const { data: externalRows, error: externalError } = await supabase.rpc(
    'admin_list_goods_variant_external_identities',
    { target_good_id: goodId ?? null },
  );
  if (externalError) throw new Error('옵션 ERP 식별자를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const externalByVariant = new Map<string, {
    erpCode: string | null;
    erpName: string | null;
    barcode: string | null;
    externalUpdatedAt: string | null;
  }>();
  for (const row of (externalRows ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.variant_id !== 'string') continue;
    externalByVariant.set(row.variant_id, {
      erpCode: typeof row.erp_code === 'string' ? row.erp_code : null,
      erpName: typeof row.erp_name === 'string' ? row.erp_name : null,
      barcode: typeof row.barcode === 'string' ? row.barcode : null,
      externalUpdatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    });
  }
  return variants.map((variant) => ({
    ...variant,
    ...(externalByVariant.get(variant.id) ?? {
      erpCode: null,
      erpName: null,
      barcode: null,
      externalUpdatedAt: null,
    }),
  }));
}
