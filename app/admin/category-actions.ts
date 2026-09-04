'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  normalizeAdminCategoryForm,
  normalizeGoodPricingForm,
  normalizeGoodSaleWindowForm,
  normalizeGoodSearchSeoForm,
} from '@/lib/admin/categories';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * D-9 분류 · D-10 판매 기간 액션.
 *
 * 판매 상태는 서버가 파생해 돌려주므로(스위치·판매 기간 RPC 의 반환값) 성공 문구에 그대로 싣는다 —
 * 브라우저가 시계로 다시 판정하지 않는다.
 */

const RPC_MESSAGES: [string, string][] = [
  ['catalog_id_immutable', '분류 코드는 저장 후 바꿀 수 없습니다.'],
  ['catalog_id_taken', '이미 쓰고 있는 분류 코드입니다.'],
  ['category_parent_missing', '상위 분류를 찾을 수 없습니다.'],
  ['category_depth_exceeded', '분류는 4단까지입니다.'],
  ['category_collection_flat', '기획전은 상위 분류를 가질 수 없습니다.'],
  ['category_cycle', '자기 자신이나 하위 분류 아래로는 옮길 수 없습니다.'],
  ['category_reorder_incomplete', '순서를 바꾸려면 같은 단계의 항목 전체를 보내야 합니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ['category_not_empty', '하위 분류나 소속 상품이 남아 있어 보관할 수 없습니다.'],
  ['category_missing', '분류를 찾을 수 없습니다.'],
  ['category_primary_required', '대표 분류를 하나 골라야 합니다.'],
  ['category_auto_sorted', '자동 정렬 분류는 순서를 직접 바꿀 수 없습니다.'],
  ['category_membership_missing', '그 분류에 속하지 않은 상품입니다.'],
  ['display_window_invalid', '진열 종료는 시작보다 뒤여야 합니다.'],
  ['sale_window_invalid', '판매 종료는 시작보다 뒤여야 합니다.'],
  ['preorder_ship_date_required', '선주문은 출고 예정일이 필요합니다.'],
  ['sale_mode_invalid', '판매 방식을 확인해주세요.'],
  ['reason_required', '중지·숨김에는 사유가 필요합니다.'],
  ['goods_keywords_limit', '검색어는 50개까지입니다.'],
  ['goods_gallery_alts_mismatch', '갤러리 설명 개수가 이미지 수와 다릅니다.'],
  ['tax_type_invalid', '과세 구분을 확인해주세요.'],
  ['supply_price_invalid', '공급가를 확인해주세요.'],
  ['good_not_found', '굿즈를 찾을 수 없습니다.'],
  ['request_conflict', '이미 처리된 요청입니다. 화면을 새로고침해주세요.'],
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

function revalidateCatalogPaths(goodId?: string | null) {
  for (const path of ['/', '/shop', '/admin', '/admin/catalog/goods', '/admin/catalog/categories']) {
    revalidatePath(path);
  }
  if (goodId) revalidatePath(`/shop/${goodId}`);
}

export async function upsertCategoryAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeAdminCategoryForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_category', {
    target_id: value.id,
    target_name: value.name,
    target_parent_id: value.parentId,
    target_kind: value.kind,
    target_description: value.description,
    target_status: value.status,
    target_is_internal: value.isInternal,
    target_display_mode: value.displayMode,
    target_auto_sort_key: value.autoSortKey,
    target_soldout_last: value.soldoutLast,
    target_include_descendants: value.includeDescendants,
    target_hero_image_path: null,
    target_seo_title: value.seoTitle,
    target_seo_description: value.seoDescription,
    target_previous_id: value.previousId,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '분류를 저장하지 못했습니다.') } };

  revalidateCatalogPaths();
  return { message: `분류 ${value.name}을(를) 저장했습니다.` };
}

export async function moveCategoryAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const id = String(formData.get('id') ?? '').trim();
  const parentId = String(formData.get('parentId') ?? '').trim();
  const positionRaw = String(formData.get('position') ?? '').trim();
  if (!id) return { errors: { form: '분류를 찾을 수 없습니다.' } };
  if (positionRaw && !/^\d+$/.test(positionRaw)) return { errors: { position: '순서는 0 이상의 정수여야 합니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_move_category', {
    target_id: id,
    target_new_parent_id: parentId || null,
    target_position: positionRaw ? Number(positionRaw) : null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '분류를 옮기지 못했습니다.') } };

  revalidateCatalogPaths();
  return { message: '분류를 옮겼습니다.' };
}

export async function reorderCategoriesAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const parentId = String(formData.get('parentId') ?? '').trim();
  const requestId = String(formData.get('requestId') ?? '').trim();
  const ordered = String(formData.get('orderedIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ordered.length === 0) return { errors: { form: '순서를 읽지 못했습니다.' } };

  /* 한 폼에 위·아래 버튼이 여럿 있고 눌린 버튼만 값을 보낸다 — 그 한 번의 자리바꿈을 여기서 계산한다. */
  const moved = swapOrder(ordered, String(formData.get('move') ?? ''));
  if (!moved) return { errors: { form: '옮길 항목을 찾지 못했습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_reorder_categories', {
    target_parent_id: parentId || null,
    target_ordered_ids: moved,
    target_request_id: requestId || null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '순서를 저장하지 못했습니다.') } };

  revalidateCatalogPaths();
  return { message: '분류 순서를 저장했습니다.' };
}

export async function archiveCategoryAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const id = String(formData.get('id') ?? '').trim();
  const archived = String(formData.get('archived') ?? '') === 'true';
  if (!id) return { errors: { form: '분류를 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_archive_category', { target_id: id, target_archived: archived });
  if (error) return { errors: { form: rpcMessage(error.message, '분류 상태를 바꾸지 못했습니다.') } };

  revalidateCatalogPaths();
  return { message: archived ? '분류를 보관했습니다.' : '분류를 복원했습니다.' };
}

export async function setGoodCategoriesAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const goodId = String(formData.get('goodId') ?? '').trim();
  const primary = String(formData.get('primaryCategoryId') ?? '').trim();
  const selected = formData.getAll('categoryIds').map((id) => String(id).trim()).filter(Boolean);
  if (!goodId) return { errors: { form: '굿즈를 찾을 수 없습니다.' } };
  if (selected.length > 0 && !primary) return { errors: { primaryCategoryId: '대표 분류를 골라주세요.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_categories', {
    target_good_id: goodId,
    target_primary_category_id: primary || null,
    target_category_ids: selected,
    target_request_id: null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '분류를 저장하지 못했습니다.') } };

  revalidateCatalogPaths(goodId);
  return { message: selected.length > 0 ? `분류 ${selected.length}개를 저장했습니다.` : '분류를 모두 해제했습니다.' };
}

export async function reorderCategoryGoodsAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const categoryId = String(formData.get('categoryId') ?? '').trim();
  const requestId = String(formData.get('requestId') ?? '').trim();
  const ordered = String(formData.get('orderedGoodIds') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  let pinned = String(formData.get('pinnedGoodIds') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!categoryId || ordered.length === 0) return { errors: { form: '순서를 읽지 못했습니다.' } };

  const command = String(formData.get('move') ?? '');
  const [commandId, commandKind] = command.split(':');
  /* 고정 핀 토글과 자리바꿈이 같은 폼을 쓴다 — 누른 버튼이 무엇을 뜻하는지로 갈린다. */
  if (commandKind === 'pin') {
    pinned = pinned.includes(commandId) ? pinned.filter((id) => id !== commandId) : [...pinned, commandId];
  }
  const movedGoods = commandKind === 'pin' ? ordered : swapOrder(ordered, command);
  if (!movedGoods) return { errors: { form: '옮길 항목을 찾지 못했습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_reorder_category_goods', {
    target_category_id: categoryId,
    target_ordered_good_ids: movedGoods,
    target_pinned_good_ids: pinned,
    target_request_id: requestId || null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '진열 순서를 저장하지 못했습니다.') } };

  revalidateCatalogPaths();
  return { message: commandKind === 'pin' ? '고정 여부를 저장했습니다.' : '진열 순서를 저장했습니다.' };
}

export async function setCategoryGoodDisplayWindowAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const categoryId = String(formData.get('categoryId') ?? '').trim();
  const goodId = String(formData.get('goodId') ?? '').trim();
  const from = String(formData.get('displayFrom') ?? '').trim();
  const until = String(formData.get('displayUntil') ?? '').trim();
  if (!categoryId || !goodId) return { errors: { form: '분류와 상품을 확인해주세요.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_category_good_display_window', {
    target_category_id: categoryId,
    target_good_id: goodId,
    target_display_from: from || null,
    target_display_until: until || null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '진열 기간을 저장하지 못했습니다.') } };

  revalidateCatalogPaths(goodId);
  return { message: from || until ? '진열 기간을 저장했습니다.' : '진열 기간을 해제했습니다.' };
}

export async function setGoodSaleWindowAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeGoodSaleWindowForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_good_sale_window', {
    target_good_id: value.goodId,
    target_sale_starts_at: value.startsAt,
    target_sale_ends_at: value.endsAt,
    target_sale_mode: value.saleMode,
    target_preorder_ships_at: value.preorderShipsAt,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '판매 기간을 저장하지 못했습니다.') } };

  revalidateCatalogPaths(value.goodId);
  return { message: `판매 기간을 저장했습니다. 지금 상태는 「${saleStateLabel(String(data ?? ''))}」입니다.` };
}

export async function setGoodSwitchAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const goodId = String(formData.get('goodId') ?? '').trim();
  const kind = String(formData.get('switch') ?? '').trim();
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  const reason = String(formData.get('reason') ?? '').trim();
  if (!goodId) return { errors: { form: '굿즈를 찾을 수 없습니다.' } };
  if (kind !== 'selling' && kind !== 'visible') return { errors: { form: '스위치를 확인해주세요.' } };
  if (!enabled && !reason) return { errors: { reason: '중지·숨김에는 사유가 필요합니다.' } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_good_switch', {
    target_good_id: goodId,
    target_switch: kind,
    target_enabled: enabled,
    target_reason: reason || null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '상태를 바꾸지 못했습니다.') } };

  revalidateCatalogPaths(goodId);
  return { message: `상태를 바꿨습니다. 지금 상태는 「${saleStateLabel(String(data ?? ''))}」입니다.` };
}

export async function setGoodSearchSeoAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeGoodSearchSeoForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_search_seo', {
    target_good_id: value.goodId,
    target_summary: value.summary,
    target_search_keywords: value.keywords,
    target_seo_title: value.seoTitle,
    target_seo_description: value.seoDescription,
    target_image_alt: value.imageAlt,
    target_gallery_alts: null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '검색·SEO 정보를 저장하지 못했습니다.') } };

  revalidateCatalogPaths(value.goodId);
  return { message: '검색·SEO 정보를 저장했습니다.' };
}

export async function setGoodPricingAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeGoodPricingForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_pricing', {
    target_good_id: value.goodId,
    target_supply_price: value.supplyPrice,
    target_tax_type: value.taxType,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '공급가·과세 구분을 저장하지 못했습니다.') } };

  revalidateCatalogPaths(value.goodId);
  return { message: '공급가·과세 구분을 저장했습니다.' };
}

/**
 * `<id>:up` · `<id>:down` 한 번의 자리바꿈. 끝에서 더 밀면 그대로 둔다(버튼을 숨기는 대신 무해하게 끝난다).
 * 명령이 없으면 보낸 순서를 그대로 쓴다.
 */
function swapOrder(ordered: string[], command: string): string[] | null {
  if (!command) return ordered;
  const [id, direction] = command.split(':');
  const index = ordered.indexOf(id);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ordered;
  const next = ordered.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/* 액션 파일 안에서만 쓰는 표기 — 순수 모듈의 라벨 표를 서버에서도 같은 값으로 읽는다. */
function saleStateLabel(state: string) {
  const labels: Record<string, string> = {
    on_sale: '판매중', preorder: '선주문', soldout: '품절', scheduled: '판매 예정',
    ended: '기간 만료', stopped: '판매 중지', hidden: '진열 안 함', archived: '보관',
  };
  return labels[state] ?? state;
}
