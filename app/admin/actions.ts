'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  catalogContextFromSnapshot,
  normalizeAdminCardForm,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminIpForm,
  normalizeAdminStockAdjustmentForm,
  type AdminFieldErrors,
} from '@/lib/admin/catalog';
import {
  normalizeAdminHidePostForm,
  normalizeAdminReportStatusForm,
} from '@/lib/admin/moderation';
import { normalizeAdminUserRoleForm } from '@/lib/admin/roles';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { getCatalogSnapshot } from '@/lib/catalog';
import { createClient } from '@/lib/supabase/server';

export interface AdminCatalogActionState {
  errors?: AdminFieldErrors & { form?: string };
  message?: string;
}

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffAction(): Promise<AdminCatalogActionState | null> {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(loginPath());
  }

  if (!auth.isStaff) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }

  return null;
}

/* 역할 부여·회수는 staff가 아니라 admin 전용 — RPC도 내부에서 재검사한다. */
async function requireAdminAction(): Promise<AdminCatalogActionState | null> {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(loginPath());
  }

  if (auth.role !== 'admin') {
    return { errors: { form: '최고 관리자(admin) 권한이 필요합니다.' } };
  }

  return null;
}

function revalidateCatalog(paths: string[]) {
  const defaults = ['/', '/ip', '/shop', '/binder', '/events', '/admin'];
  for (const path of [...defaults, ...paths]) {
    revalidatePath(path);
  }
}

function revalidateStock(ipPath: string | null) {
  const paths = ['/', '/ip', '/shop', '/cart', '/checkout', '/admin'];
  if (ipPath) paths.push(ipPath);
  for (const path of paths) revalidatePath(path);
}

function readRpcIpId(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== 'object') return null;
  const ipId = (candidate as { ipId?: unknown; ip_id?: unknown }).ipId ?? (candidate as { ip_id?: unknown }).ip_id;
  return typeof ipId === 'string' && ipId.trim() ? ipId : null;
}

function revalidateModeration(ipId: string | null = null) {
  for (const path of ['/admin', '/community', '/', '/search']) {
    revalidatePath(path);
  }
  if (ipId) revalidatePath(`/ip/${ipId}`);
}

function readPreviousIpPath(formData: FormData) {
  const value = formData.get('previousIpId');
  if (typeof value !== 'string') return null;

  const ipId = value.trim();
  return /^[a-z0-9][a-z0-9-]*$/.test(ipId) ? `/ip/${ipId}` : null;
}

function readStockIpPath(formData: FormData) {
  const value = formData.get('ipId');
  if (typeof value !== 'string') return null;

  const ipId = value.trim();
  return /^[a-z0-9][a-z0-9-]*$/.test(ipId) ? `/ip/${ipId}` : null;
}

function relatedIpPaths(currentIpId: string | null, previousIpPath: string | null) {
  const paths = currentIpId ? [`/ip/${currentIpId}`] : [];
  if (previousIpPath && !paths.includes(previousIpPath)) paths.push(previousIpPath);
  return paths;
}

function rpcFailure(message: string): AdminCatalogActionState {
  return { errors: { form: message } };
}

function getAdminValidationCatalog() {
  return getCatalogSnapshot({ previewDefaultSource: 'supabase' });
}

export async function upsertAdminIpAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const catalog = await getAdminValidationCatalog();
  const result = normalizeAdminIpForm(formData, catalogContextFromSnapshot(catalog));
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_ip', {
    target_id: value.id,
    target_title: value.title,
    target_sub: value.sub,
    target_vertical_key: value.verticalKey,
    target_tagline: value.tagline,
    target_synopsis: value.synopsis,
    target_glyph: value.glyph,
    target_bg: value.bg,
    target_image_path: value.imagePath,
    target_featured: value.featured,
  });

  if (error) return rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.');

  revalidateCatalog([`/ip/${value.id}`]);
  return { message: 'IP를 저장했습니다.' };
}

export async function upsertAdminGoodAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const catalog = await getAdminValidationCatalog();
  const result = normalizeAdminGoodForm(formData, catalogContextFromSnapshot(catalog));
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const previousIpPath = readPreviousIpPath(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_good', {
    target_id: value.id,
    target_ip_id: value.ipId,
    target_name: value.name,
    target_type: value.type,
    target_price: value.price,
    target_badge: value.badge,
    target_stock: value.stock,
    target_bg: value.bg,
    target_image_path: value.imagePath,
  });

  if (error) return rpcFailure('굿즈를 저장하지 못했습니다. 다시 시도해주세요.');

  revalidateCatalog(relatedIpPaths(value.ipId, previousIpPath));
  return { message: '굿즈를 저장했습니다.' };
}

export async function adjustAdminStockAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminStockAdjustmentForm(formData);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const ipPath = readStockIpPath(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_adjust_stock', {
    target_adjustment_id: value.adjustmentId,
    target_good_id: value.goodId,
    target_expected_stock_qty: value.expectedStockQty,
    target_delta: value.delta,
    target_reason: value.reason,
  });

  if (error) {
    if (error.message.includes('stock_changed')) {
      revalidateStock(ipPath);
      return rpcFailure('실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.');
    }
    if (error.message.includes('adjustment_conflict')) {
      revalidateStock(ipPath);
      return rpcFailure('이미 사용된 재고 조정 요청입니다. 최신 수량을 확인해주세요.');
    }
    if (error.message.includes('stock_out_of_range')) {
      return rpcFailure('재고는 0개 미만이거나 허용 범위를 넘도록 조정할 수 없습니다.');
    }
    if (error.message.includes('good_not_found')) {
      return rpcFailure('굿즈를 찾을 수 없습니다.');
    }
    return rpcFailure('실재고를 조정하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateStock(ipPath);
  return { message: '실재고를 조정했습니다.' };
}

export async function upsertAdminCardAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const catalog = await getAdminValidationCatalog();
  const result = normalizeAdminCardForm(formData, catalogContextFromSnapshot(catalog));
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const previousIpPath = readPreviousIpPath(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_card', {
    target_id: value.id,
    target_ip_id: value.ipId,
    target_name: value.name,
    target_no: value.no,
    target_rarity: value.rarity,
    target_bg: value.bg,
    target_image_path: value.imagePath,
  });

  if (error) return rpcFailure('카드를 저장하지 못했습니다. 다시 시도해주세요.');

  revalidateCatalog(relatedIpPaths(value.ipId, previousIpPath));
  return { message: '카드를 저장했습니다.' };
}

export async function upsertAdminEventAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const catalog = await getAdminValidationCatalog();
  const result = normalizeAdminEventForm(formData, catalogContextFromSnapshot(catalog));
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const previousIpPath = readPreviousIpPath(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_event', {
    target_id: value.id,
    target_ip_id: value.ipId,
    target_title: value.title,
    target_mode: value.mode,
    target_status: value.status,
    target_starts_at: value.startsAt,
    target_ends_at: value.endsAt,
    target_location: value.location,
    target_accent: value.accent,
    target_bg: value.bg,
    target_image_path: value.imagePath,
  });

  if (error) return rpcFailure('이벤트를 저장하지 못했습니다. 다시 시도해주세요.');

  revalidateCatalog(relatedIpPaths(value.ipId, previousIpPath));
  return { message: '이벤트를 저장했습니다.' };
}

export async function setAdminUserRoleAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireAdminAction();
  if (authError) return authError;

  const result = normalizeAdminUserRoleForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_user_role', {
    target_profile_id: result.value.profileId,
    target_role: result.value.role,
  });

  if (error) {
    if (error.message.includes('cannot_change_own_role')) {
      return rpcFailure('본인 역할은 변경할 수 없습니다.');
    }
    if (error.message.includes('profile_not_found')) {
      return rpcFailure('사용자를 찾을 수 없습니다.');
    }
    return rpcFailure('역할을 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidatePath('/admin');
  return { message: '역할을 저장했습니다.' };
}

export async function updateCommunityReportStatusAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminReportStatusForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_report_status', {
    target_report_id: result.value.reportId,
    target_status: result.value.status,
  });

  if (error) return rpcFailure('신고 상태를 저장하지 못했습니다. 다시 시도해주세요.');

  revalidateModeration();
  return { message: '신고 상태를 저장했습니다.' };
}

export async function hideCommunityPostAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminHidePostForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('admin_hide_community_post', {
    target_post_id: result.value.postId,
    target_report_id: result.value.reportId,
  });

  if (error) return rpcFailure('포스트를 숨김 처리하지 못했습니다. 다시 시도해주세요.');

  revalidateModeration(readRpcIpId(data));
  return { message: '포스트를 숨김 처리했습니다.' };
}
