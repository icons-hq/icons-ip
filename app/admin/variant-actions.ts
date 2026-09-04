'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  isUuid,
  normalizeOptionMasterForm,
  normalizeStockLocationForm,
  normalizeVariantSafetyForm,
  normalizeVariantStockAdjustmentForm,
  normalizeVariantTransferForm,
  parseBulkStockRows,
  parseVariantBatchPayload,
  toVariantBatchRpcArgs,
} from '@/lib/admin/variants';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * D-1 옵션 · 품목 · 출고지별 재고 액션.
 *
 * 쓰기는 전부 RPC(멱등 키 · 감사 · 역할 검사)가 맡고, 여기서는 폼을 좁혀 넘기고 실패 코드를
 * 운영자 문장으로 바꾼다. 재고가 바뀌면 공개 화면(상품·IP·카트)도 캐시가 낡으므로 함께 되살린다.
 */

const RPC_MESSAGES: [string, string][] = [
  ['stock_changed', '재고가 그 사이 바뀌었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.'],
  ['adjustment_conflict', '이미 처리된 요청입니다. 최신 수량을 확인해주세요.'],
  ['stock_out_of_range', '재고는 0 미만이거나 허용 범위를 넘을 수 없습니다.'],
  ['stock_note_required', '보정은 사유를 적어야 합니다.'],
  ['invalid_stock_reason', '조정 사유를 확인해주세요.'],
  ['variant_not_found', '품목을 찾을 수 없습니다.'],
  ['location_not_found', '출고지를 찾을 수 없습니다.'],
  ['catalog_item_archived', '보관된 상품·품목에는 재고를 넣을 수 없습니다. 복원한 뒤 다시 시도해주세요.'],
  ['goods_stock_qty_readonly', '품목이 여러 개인 상품은 품목 단위로 조정합니다.'],
  ['variant_duplicate', '같은 옵션 조합의 품목이 이미 있습니다.'],
  ['variant_limit', '옵션은 3개, 품목은 200개까지입니다.'],
  ['variant_values_required', '모든 옵션의 값을 고른 품목만 저장할 수 있습니다.'],
  ['variant_signature_immutable', '기존 품목의 옵션 조합은 바꿀 수 없습니다. 새 품목을 추가하고 이전 품목을 보관하세요.'],
  ['variant_initial_stock_existing', '기존 품목의 수량은 재고 조정으로 바꿉니다.'],
  ['variant_options_locked', '옵션 구성을 바꾸려면 기존 옵션 품목을 먼저 보관해야 합니다.'],
  ['variant_options_required', '옵션이 없는 상품은 기본 품목 하나만 가집니다.'],
  ['custom_code_taken', '이미 쓰고 있는 자체 품목코드입니다.'],
  ['option_not_found', '옵션 마스터를 찾을 수 없습니다.'],
  ['option_value_not_found', '옵션값을 찾을 수 없습니다.'],
  ['option_in_use', '상품이 쓰고 있는 옵션은 보관할 수 없습니다.'],
  ['option_value_in_use', '품목이 쓰고 있는 옵션값은 보관할 수 없습니다.'],
  ['option_duplicate', '같은 옵션을 두 번 고를 수 없습니다.'],
  ['location_default_required', '기본 출고지는 다른 출고지를 기본으로 지정한 뒤에 바꿀 수 있습니다.'],
  ['location_has_stock', '재고가 남아 있는 출고지는 비활성화할 수 없습니다. 먼저 다른 출고지로 이동하세요.'],
  ['location_default_must_be_active', '기본 출고지는 사용 중이어야 합니다.'],
  ['carrier_not_found', '택배사를 찾을 수 없습니다.'],
  ['invalid_location_id', '출고지 코드는 영문 소문자·숫자·하이픈이어야 합니다.'],
  ['transfer_same_slot', '같은 자리로는 옮길 수 없습니다.'],
  ['variant_transfer_cross_good', '다른 상품의 품목으로는 옮길 수 없습니다.'],
  ['good_not_found', '상품을 찾을 수 없습니다.'],
  ['auth_required', '로그인이 필요합니다.'],
  ['forbidden', '관리자 권한이 필요합니다.'],
];

function rpcMessage(message: string, fallback: string) {
  const hit = RPC_MESSAGES.find(([code]) => message.includes(code));
  return hit ? hit[1] : fallback;
}

async function requireStaff(): Promise<AdminCatalogActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

function revalidateStockPaths(goodId: string | null) {
  for (const path of ['/', '/shop', '/cart', '/checkout', '/admin', '/admin/catalog/goods', '/admin/catalog/inventory']) {
    revalidatePath(path);
  }
  if (goodId) revalidatePath(`/shop/${goodId}`);
}

export async function saveGoodVariantsAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const goodId = String(formData.get('goodId') ?? '').trim();
  const batchId = String(formData.get('batchId') ?? '').trim().toLowerCase();
  if (!goodId || !isUuid(batchId)) {
    return { errors: { form: '유효한 저장 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.' } };
  }
  const payload = parseVariantBatchPayload(String(formData.get('payload') ?? ''));
  if (!payload.ok) return { errors: { form: payload.error } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_upsert_variants', toVariantBatchRpcArgs(goodId, batchId, payload.value));
  if (error) return { errors: { form: rpcMessage(error.message, '품목을 저장하지 못했습니다. 다시 시도해주세요.') } };

  revalidateStockPaths(goodId);
  const result = (data ?? {}) as { variants?: unknown[]; archived?: unknown[] };
  const saved = result.variants?.length ?? 0;
  const archived = result.archived?.length ?? 0;
  return {
    message: archived > 0
      ? `품목 ${saved}개를 저장하고 ${archived}개를 보관했습니다. 보관된 품목의 재고는 「재고 이동」으로 옮겨야 판매 수량에 잡힙니다.`
      : `품목 ${saved}개를 저장했습니다.`,
  };
}

export async function adjustVariantStockAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeVariantStockAdjustmentForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_adjust_variant_stock', {
    target_movement_id: value.movementId,
    target_variant_id: value.variantId,
    target_location_id: value.locationId,
    target_expected_on_hand: value.expectedOnHand,
    target_delta: value.delta,
    target_reason_code: value.reasonCode,
    target_note: value.note,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '재고를 조정하지 못했습니다. 다시 시도해주세요.') } };

  revalidateStockPaths(value.goodId || null);
  const row = ((data ?? []) as { on_hand_qty: number; available: number }[])[0];
  return {
    message: row
      ? `재고를 조정했습니다. 보유 ${row.on_hand_qty.toLocaleString('ko-KR')}개 · 가용 ${row.available.toLocaleString('ko-KR')}개`
      : '재고를 조정했습니다.',
  };
}

export async function transferVariantStockAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeVariantTransferForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_transfer_variant_stock', {
    target_movement_id: value.movementId,
    target_from_variant_id: value.fromVariantId,
    target_from_location_id: value.fromLocationId,
    target_to_variant_id: value.toVariantId,
    target_to_location_id: value.toLocationId,
    target_qty: value.qty,
    target_note: value.note,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '재고를 옮기지 못했습니다. 다시 시도해주세요.') } };

  revalidateStockPaths(value.goodId || null);
  const row = ((data ?? []) as { from_on_hand: number; to_on_hand: number }[])[0];
  return {
    message: row
      ? `${value.qty.toLocaleString('ko-KR')}개를 옮겼습니다. 출발 ${row.from_on_hand.toLocaleString('ko-KR')}개 · 도착 ${row.to_on_hand.toLocaleString('ko-KR')}개`
      : '재고를 옮겼습니다.',
  };
}

export async function setVariantSafetyAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeVariantSafetyForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_variant_safety', {
    target_variant_id: value.variantId,
    target_location_id: value.locationId,
    target_safety_qty: value.safetyQty,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '안전재고를 저장하지 못했습니다.') } };

  revalidateStockPaths(value.goodId || null);
  return { message: `안전재고를 ${value.safetyQty.toLocaleString('ko-KR')}개로 저장했습니다.` };
}

export async function setVariantStockBulkAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const batchId = String(formData.get('batchId') ?? '').trim().toLowerCase();
  if (!isUuid(batchId)) return { errors: { form: '유효한 업로드 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.' } };
  const kind = String(formData.get('kind') ?? 'excel') === 'wms' ? 'wms' : 'excel';
  const parsed = parseBulkStockRows(String(formData.get('rows') ?? ''));
  if (parsed.errors.length > 0) {
    return { errors: { rows: parsed.errors.slice(0, 5).map((entry) => `${entry.line}행: ${entry.message}`).join(' ') } };
  }
  if (parsed.rows.length === 0) return { errors: { rows: '적용할 행이 없습니다.' } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_variant_stock_bulk', {
    target_batch_id: batchId,
    target_kind: kind,
    target_rows: parsed.rows.map((row) => ({
      ref: row.ref,
      ...(row.locationId ? { location_id: row.locationId } : {}),
      on_hand_qty: row.onHandQty,
      ...(row.safetyQty !== undefined ? { safety_qty: row.safetyQty } : {}),
    })),
    target_reason_code: kind === 'wms' ? 'wms_sync' : 'excel_set',
    target_file_name: null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '재고를 일괄 반영하지 못했습니다.') } };

  const result = (data ?? {}) as { applied?: number; errors?: { row: number; code: string }[]; warnings?: { row: number; code: string }[] };
  if (result.errors && result.errors.length > 0) {
    return {
      errors: {
        rows: `반영하지 않았습니다. ${result.errors.slice(0, 5).map((entry) => `${entry.row}행 ${BULK_ERROR_LABELS[entry.code] ?? entry.code}`).join(' · ')}`,
      },
    };
  }
  revalidateStockPaths(null);
  const warnings = result.warnings?.length ?? 0;
  return {
    message: `${(result.applied ?? 0).toLocaleString('ko-KR')}행의 수량을 맞췄습니다.${warnings > 0 ? ` ${warnings}행은 예약 수량보다 적어 가용이 음수입니다.` : ''}`,
  };
}

const BULK_ERROR_LABELS: Record<string, string> = {
  ref_missing: '참조 없음',
  variant_not_found: '품목 없음',
  variant_ambiguous: '품목이 여러 개(품목코드로 지정)',
  location_not_found: '출고지 없음',
  invalid_qty: '수량 오류',
  duplicate_row: '중복 행',
};

export async function upsertStockLocationAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeStockLocationForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_stock_location', {
    target_id: value.id,
    target_name: value.name,
    target_address: null,
    target_contact: value.contact,
    target_default_carrier_code: value.defaultCarrierCode,
    target_erp_warehouse_code: value.erpWarehouseCode,
    target_is_default: value.isDefault,
    target_active: value.active,
    target_sort_order: value.sortOrder,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '출고지를 저장하지 못했습니다.') } };

  revalidatePath('/admin/settings/shipping');
  revalidatePath('/admin/catalog/goods');
  revalidatePath('/admin/catalog/inventory');
  return { message: `출고지 ${value.name}을(를) 저장했습니다.` };
}

export async function upsertOptionMasterAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeOptionMasterForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_option_master', {
    target_id: value.id,
    target_name: value.name,
    target_display_style: value.displayStyle,
    target_sort_order: value.sortOrder,
    target_archived: value.archived,
    target_values: value.values.map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      value: entry.value,
      ...(entry.sortOrder !== undefined ? { sort_order: entry.sortOrder } : {}),
      ...(entry.archived !== undefined ? { archived: entry.archived } : {}),
    })),
  });
  if (error) return { errors: { form: rpcMessage(error.message, '옵션을 저장하지 못했습니다.') } };

  revalidatePath('/admin/catalog/options');
  revalidatePath('/admin/catalog/goods');
  return { message: `옵션 ${value.name}을(를) 저장했습니다.` };
}
