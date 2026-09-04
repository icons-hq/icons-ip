import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  type AdminGoodOption,
  type AdminGoodVariant,
  type AdminGoodVariantEditorData,
  type AdminInventoryFilters,
  type AdminOptionMaster,
  type AdminStockLocation,
} from './variants';

/*
 * D-1 로더. 재고 표(variant_stocks)·이동 기록은 RLS 가 스태프에게만 열려 있고, 마스터·품목은 공개다.
 * 목록은 RPC 가 자른다(규모 슬라이스 규칙). 편집 화면은 상품 하나의 품목만 읽으므로 select 로 충분하다.
 */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

function rows<Row>(result: RpcResult, what: string): Row[] {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

interface LocationRow {
  id: string;
  name: string;
  contact: string | null;
  erp_warehouse_code: string | null;
  default_carrier_code: string | null;
  is_default: boolean;
  active: boolean;
  sort_order: number;
}

interface MasterRow {
  id: string;
  code: string;
  name: string;
  display_style: string;
  sort_order: number;
  archived_at: string | null;
}

interface ValueRow {
  id: string;
  option_id: string;
  value: string;
  sort_order: number;
  archived_at: string | null;
}

interface VariantRow {
  id: string;
  code: string;
  custom_code: string | null;
  option_signature: string;
  is_default: boolean;
  additional_price: number;
  display: boolean;
  sellable: boolean;
  location_id: string | null;
  image_path: string | null;
  sort_order: number;
  archived_at: string | null;
}

interface VariantValueRow {
  variant_id: string;
  option_id: string;
  value_id: string;
}

interface StockRow {
  variant_id: string;
  location_id: string;
  on_hand_qty: number;
  reserved_qty: number;
  safety_qty: number;
  last_source: string;
  last_movement_at: string | null;
  counted_at: string | null;
}

function toLocation(row: LocationRow): AdminStockLocation {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    erpWarehouseCode: row.erp_warehouse_code,
    defaultCarrierCode: row.default_carrier_code,
    isDefault: row.is_default,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

const LOCATION_SELECT = 'id,name,contact,erp_warehouse_code,default_carrier_code,is_default,active,sort_order';
const MASTER_SELECT = 'id,code,name,display_style,sort_order,archived_at';
const VALUE_SELECT = 'id,option_id,value,sort_order,archived_at';
const VARIANT_SELECT = 'id,code,custom_code,option_signature,is_default,additional_price,display,sellable,location_id,image_path,sort_order,archived_at';
const STOCK_SELECT = 'variant_id,location_id,on_hand_qty,reserved_qty,safety_qty,last_source,last_movement_at,counted_at';

export async function getAdminStockLocations(options: { activeOnly?: boolean } = {}): Promise<AdminStockLocation[]> {
  const supabase = await createClient();
  let query = supabase.from('stock_locations').select(LOCATION_SELECT).order('sort_order').order('id');
  if (options.activeOnly) query = query.eq('active', true);
  const result = await query;
  return rows<LocationRow>(result, 'stock locations').map(toLocation);
}

export async function getAdminOptionMasters(options: { includeArchived?: boolean } = {}): Promise<AdminOptionMaster[]> {
  const supabase = await createClient();
  let masterQuery = supabase.from('option_masters').select(MASTER_SELECT).order('sort_order').order('code');
  if (!options.includeArchived) masterQuery = masterQuery.is('archived_at', null);
  const [masterResult, valueResult] = await Promise.all([
    masterQuery,
    supabase.from('option_values').select(VALUE_SELECT).order('sort_order').order('value'),
  ]);
  const values = rows<ValueRow>(valueResult, 'option values');
  return rows<MasterRow>(masterResult, 'option masters').map((master) => ({
    id: master.id,
    code: master.code,
    name: master.name,
    displayStyle: master.display_style,
    sortOrder: master.sort_order,
    archivedAt: master.archived_at,
    values: values
      .filter((value) => value.option_id === master.id)
      .map((value) => ({ id: value.id, value: value.value, sortOrder: value.sort_order, archivedAt: value.archived_at })),
  }));
}

export async function getAdminGoodVariantEditorData(goodId: string): Promise<AdminGoodVariantEditorData | null> {
  const supabase = await createClient();
  const [goodResult, optionResult, variantResult, masters, locations] = await Promise.all([
    supabase.from('goods').select('id,default_location_id,stock_override').eq('id', goodId).maybeSingle(),
    supabase.from('good_options').select('option_id,position').eq('good_id', goodId).order('position'),
    supabase.from('good_variants').select(VARIANT_SELECT).eq('good_id', goodId).order('sort_order').order('code'),
    getAdminOptionMasters(),
    getAdminStockLocations(),
  ]);
  if (goodResult.error) throw new Error(`Failed to load admin good ${goodId}: ${goodResult.error.message}`);
  const good = goodResult.data as { id: string; default_location_id: string; stock_override: string } | null;
  if (!good) return null;

  const variantRows = rows<VariantRow>(variantResult, 'good variants');
  const variantIds = variantRows.map((variant) => variant.id);
  const [valueResult, stockResult] = variantIds.length > 0
    ? await Promise.all([
      supabase.from('variant_option_values').select('variant_id,option_id,value_id').in('variant_id', variantIds),
      supabase.from('variant_stocks').select(STOCK_SELECT).in('variant_id', variantIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const variantValues = rows<VariantValueRow>(valueResult, 'variant option values');
  const stocks = rows<StockRow>(stockResult, 'variant stocks');
  const locationOrder = new Map(locations.map((location, index) => [location.id, index]));

  const options: AdminGoodOption[] = rows<{ option_id: string; position: number }>(optionResult, 'good options')
    .map((row) => ({ optionId: row.option_id, position: row.position }));

  const variants: AdminGoodVariant[] = variantRows.map((row) => ({
    id: row.id,
    code: row.code,
    customCode: row.custom_code,
    signature: row.option_signature,
    isDefault: row.is_default,
    additionalPrice: row.additional_price,
    display: row.display,
    sellable: row.sellable,
    locationId: row.location_id,
    imagePath: row.image_path,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    values: Object.fromEntries(
      variantValues.filter((value) => value.variant_id === row.id).map((value) => [value.option_id, value.value_id]),
    ),
    stocks: stocks
      .filter((stock) => stock.variant_id === row.id)
      .sort((a, b) => (locationOrder.get(a.location_id) ?? 99) - (locationOrder.get(b.location_id) ?? 99))
      .map((stock) => ({
        locationId: stock.location_id,
        onHand: stock.on_hand_qty,
        reserved: stock.reserved_qty,
        safety: stock.safety_qty,
        lastSource: stock.last_source,
        lastMovementAt: stock.last_movement_at,
        countedAt: stock.counted_at,
      })),
  }));

  return {
    goodId: good.id,
    defaultLocationId: good.default_location_id,
    stockOverride: good.stock_override,
    options,
    masters,
    variants,
    locations,
  };
}

export interface AdminInventoryRow {
  variantId: string;
  variantCode: string;
  customCode: string | null;
  optionSummary: string;
  isDefault: boolean;
  sellable: boolean;
  display: boolean;
  variantArchivedAt: string | null;
  goodId: string;
  goodName: string;
  goodArchivedAt: string | null;
  ipId: string;
  ipTitle: string;
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  safety: number;
  lastSource: string;
  lastMovementAt: string | null;
  countedAt: string | null;
}

export interface AdminInventoryList {
  rows: AdminInventoryRow[];
  total: number;
  page: number;
  size: number;
}

interface InventoryRpcRow {
  variant_id: string;
  variant_code: string;
  custom_code: string | null;
  option_summary: string;
  is_default: boolean;
  sellable: boolean;
  display: boolean;
  variant_archived_at: string | null;
  good_id: string;
  good_name: string;
  good_archived_at: string | null;
  ip_id: string;
  ip_title: string;
  location_id: string;
  location_name: string;
  on_hand_qty: number;
  reserved_qty: number;
  available: number;
  safety_qty: number;
  last_source: string;
  last_movement_at: string | null;
  counted_at: string | null;
  total_count: number;
}

export function adminInventoryRpcArgs(filters: AdminInventoryFilters) {
  return {
    p_query: filters.query || null,
    p_location_id: filters.location || null,
    p_ip_id: filters.ip || null,
    p_only_low: filters.low,
    p_include_archived: filters.archived,
    p_limit: filters.size,
    p_offset: (filters.page - 1) * filters.size,
  };
}

export async function getAdminInventory(filters: AdminInventoryFilters): Promise<AdminInventoryList> {
  const supabase = await createClient();
  const result = await supabase.rpc('admin_list_variant_stocks', adminInventoryRpcArgs(filters));
  const list = rows<InventoryRpcRow>(result, 'admin inventory');
  return {
    rows: list.map((row) => ({
      variantId: row.variant_id,
      variantCode: row.variant_code,
      customCode: row.custom_code,
      optionSummary: row.option_summary,
      isDefault: row.is_default,
      sellable: row.sellable,
      display: row.display,
      variantArchivedAt: row.variant_archived_at,
      goodId: row.good_id,
      goodName: row.good_name,
      goodArchivedAt: row.good_archived_at,
      ipId: row.ip_id,
      ipTitle: row.ip_title,
      locationId: row.location_id,
      locationName: row.location_name,
      onHand: row.on_hand_qty,
      reserved: row.reserved_qty,
      available: row.available,
      safety: row.safety_qty,
      lastSource: row.last_source,
      lastMovementAt: row.last_movement_at,
      countedAt: row.counted_at,
    })),
    total: list[0]?.total_count ?? 0,
    page: filters.page,
    size: filters.size,
  };
}

export interface AdminStockMovementRow {
  id: string;
  locationId: string;
  deltaOnHand: number;
  deltaReserved: number;
  onHandAfter: number;
  reservedAfter: number;
  reasonCode: string;
  source: string;
  refType: string | null;
  refId: string | null;
  note: string | null;
  actorNickname: string | null;
  createdAt: string;
}

export async function getAdminStockMovements(variantId: string, options: { locationId?: string | null; limit?: number } = {}): Promise<AdminStockMovementRow[]> {
  const supabase = await createClient();
  const result = await supabase.rpc('admin_list_stock_movements', {
    p_variant_id: variantId,
    p_location_id: options.locationId ?? null,
    p_limit: options.limit ?? 20,
    p_offset: 0,
  });
  return rows<{
    id: string; location_id: string; delta_on_hand: number; delta_reserved: number; on_hand_after: number;
    reserved_after: number; reason_code: string; source: string; ref_type: string | null; ref_id: string | null;
    note: string | null; actor_nickname: string | null; created_at: string;
  }>(result, 'stock movements').map((row) => ({
    id: row.id,
    locationId: row.location_id,
    deltaOnHand: row.delta_on_hand,
    deltaReserved: row.delta_reserved,
    onHandAfter: row.on_hand_after,
    reservedAfter: row.reserved_after,
    reasonCode: row.reason_code,
    source: row.source,
    refType: row.ref_type,
    refId: row.ref_id,
    note: row.note,
    actorNickname: row.actor_nickname,
    createdAt: row.created_at,
  }));
}

export async function getAdminShippingCarrierOptions(): Promise<{ code: string; label: string }[]> {
  const supabase = await createClient();
  const result = await supabase.from('shipping_carriers').select('code,label').eq('is_active', true).order('sort_order').order('code');
  return rows<{ code: string; label: string }>(result, 'shipping carriers');
}
