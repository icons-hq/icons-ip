import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminShippingPolicy } from './shipping-policies';

interface ShippingPolicyRow {
  id: string;
  name: string;
  method: string;
  bundling: boolean;
  fee_kind: string;
  fee_amount: number;
  free_threshold: number | null;
  remote_surcharge: number;
  ship_from_location_id: string | null;
  exchange_location_id: string | null;
  return_location_id: string | null;
  exchange_fee: number;
  return_fee: number;
  return_restrictions: string | null;
  support_note: string | null;
  allow_bank_transfer: boolean;
  is_default: boolean;
  archived_at: string | null;
}

function toPolicy(row: ShippingPolicyRow): AdminShippingPolicy {
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    bundling: row.bundling,
    feeKind: row.fee_kind,
    feeAmount: row.fee_amount,
    freeThreshold: row.free_threshold,
    remoteSurcharge: row.remote_surcharge,
    shipFromLocationId: row.ship_from_location_id,
    exchangeLocationId: row.exchange_location_id,
    returnLocationId: row.return_location_id,
    exchangeFee: row.exchange_fee,
    returnFee: row.return_fee,
    returnRestrictions: row.return_restrictions,
    supportNote: row.support_note,
    allowBankTransfer: row.allow_bank_transfer,
    isDefault: row.is_default,
    archivedAt: row.archived_at,
  };
}

/** 정책 목록. 기본 정책이 맨 위 — 상품이 비워 두면 그걸 쓴다. */
export async function getAdminShippingPolicies(): Promise<AdminShippingPolicy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('shipping_policies')
    .select('*')
    .is('archived_at', null)
    .order('is_default', { ascending: false })
    .order('name');

  if (error) throw new Error(`Failed to load shipping policies: ${error.message}`);
  return ((data ?? []) as ShippingPolicyRow[]).map(toPolicy);
}
