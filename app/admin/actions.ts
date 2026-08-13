'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  catalogContextFromSnapshot,
  gameContextFromRecords,
  normalizeAdminCardForm,
  normalizeAdminCardPoolForm,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminGameEndForm,
  normalizeAdminGameForm,
  normalizeAdminIpForm,
  normalizeAdminPoolOddsForm,
  normalizeAdminRewardPolicyForm,
  normalizeAdminStockAdjustmentForm,
  normalizeAdminTicketTypeForm,
  type AdminFieldErrors,
} from '@/lib/admin/catalog';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import {
  normalizeAdminHideCommentForm,
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

  if (!auth.isStaff || auth.role !== 'admin') {
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

function revalidateTicketing() {
  revalidatePath('/admin');
  revalidatePath('/events');
}

function revalidateRewards() {
  for (const path of ['/admin', '/packs', '/binder']) revalidatePath(path);
}

function revalidateGames(gameIds: Array<string | null>) {
  const paths = ['/admin'];
  for (const gameId of gameIds) {
    if (gameId && !paths.includes(`/games/${gameId}`)) paths.push(`/games/${gameId}`);
  }
  paths.push('/events');
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

function artworkClaimFailure(message: string): AdminCatalogActionState | null {
  return message.includes('unverified_artwork')
    ? rpcFailure('검증된 이미지를 다시 업로드한 뒤 저장해주세요.')
    : null;
}

/* 폼 검증을 우회해 RPC 까지 닿은 고시정보 누락을 운영자 언어로 옮긴다 (#171). */
function goodsNoticeFailure(message: string): AdminCatalogActionState | null {
  return message.includes('goods_notice_required')
    ? rpcFailure('고시정보를 모두 입력한 뒤 저장해주세요.')
    : null;
}

function archivedParentFailure(message: string): AdminCatalogActionState | null {
  return message.includes('parent_archived')
    ? rpcFailure('상위 IP를 먼저 복원해주세요.')
    : null;
}

/* 신규 등록이 기존 레코드를 덮어쓰지 못하게 막은 RPC의 응답을 운영자 언어로 옮긴다 (#181). */
function catalogWriteIntentFailure(message: string): AdminCatalogActionState | null {
  if (message.includes('catalog_id_taken')) {
    return { errors: { id: '이미 사용 중인 ID입니다. 수정하려면 목록에서 선택해주세요.' } };
  }
  if (message.includes('catalog_record_missing')) {
    return rpcFailure('수정할 항목을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.');
  }
  if (message.includes('catalog_id_immutable')) {
    return { errors: { id: '등록된 ID는 변경할 수 없습니다.' } };
  }
  return null;
}

function archivedCatalogFailure(message: string): AdminCatalogActionState | null {
  return message.includes('catalog_item_archived')
    ? rpcFailure('보관된 카탈로그 항목을 먼저 복원해주세요.')
    : null;
}

function getAdminValidationCatalog() {
  return getCatalogSnapshot({ previewDefaultSource: 'supabase' });
}

type AdminValidationRecordKind = 'good' | 'card' | 'cardPool' | 'rewardPolicy' | 'event' | 'ticketType';

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

async function getAdminValidationContext(
  formData: FormData,
  kind: AdminValidationRecordKind,
) {
  const [catalog, records] = await Promise.all([
    getAdminValidationCatalog(),
    getAdminCatalogRecords(),
  ]);
  const activeContext = catalogContextFromSnapshot(catalog);
  const context = {
    ...activeContext,
    eventIds: new Set(activeContext.eventIds),
    goodIpById: new Map(activeContext.goodIpById),
    ipIds: new Set(activeContext.ipIds),
  };
  const id = formString(formData, 'id');

  if (kind === 'good') {
    const current = records.goods.find((record) => record.id === id);
    if (current) context.ipIds.add(current.ipId);
  } else if (kind === 'card') {
    const current = records.cards.find((record) => record.id === id);
    if (current) context.ipIds.add(current.ipId);
  } else if (kind === 'cardPool') {
    const current = records.cardPools.find((record) => record.id === id);
    if (current) context.ipIds.add(current.ipId);
  } else if (kind === 'rewardPolicy') {
    const current = records.rewardPolicies.find((record) => record.id === id);
    if (current) {
      context.ipIds.add(current.targetIpId);
      if (current.targetGoodId) {
        context.goodIpById.set(current.targetGoodId, current.targetIpId);
      }
    }
  } else if (kind === 'event') {
    const current = records.events.find((record) => record.id === id);
    if (current?.ipId) context.ipIds.add(current.ipId);
  } else {
    const current = records.ticketTypes.find((record) => record.id === id);
    if (current) context.eventIds.add(current.eventId);
  }

  return context;
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
    target_previous_id: value.previousId,
  });

  if (error) {
    return catalogWriteIntentFailure(error.message)
      ?? artworkClaimFailure(error.message)
      ?? rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateCatalog([`/ip/${value.id}`]);
  return { message: 'IP를 저장했습니다.' };
}

export async function upsertAdminGoodAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'good');
  const result = normalizeAdminGoodForm(formData, context);
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
    target_notice_maker: value.notice.maker,
    target_notice_origin: value.notice.origin,
    target_notice_material: value.notice.material,
    target_notice_size: value.notice.size,
    target_notice_made_on: value.notice.madeOn,
    target_notice_as_manager: value.notice.asManager,
    target_notice_as_contact: value.notice.asContact,
    target_description: value.description,
    target_gallery_paths: value.galleryPaths,
    target_detail_image_path: value.detailImagePath,
    target_previous_id: value.previousId,
  });

  if (error) {
    return catalogWriteIntentFailure(error.message)
      ?? artworkClaimFailure(error.message)
      ?? archivedParentFailure(error.message)
      ?? goodsNoticeFailure(error.message)
      ?? rpcFailure('굿즈를 저장하지 못했습니다. 다시 시도해주세요.');
  }

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
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
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

  const context = await getAdminValidationContext(formData, 'card');
  const result = normalizeAdminCardForm(formData, context);
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
    target_pool_id: value.poolId,
    target_pool_binding_provided: true,
    target_previous_id: value.previousId,
  });

  if (error) {
    revalidatePath('/admin');
    const writeIntentError = catalogWriteIntentFailure(error.message);
    if (writeIntentError) return writeIntentError;
    const artworkError = artworkClaimFailure(error.message);
    if (artworkError) return artworkError;
    const parentError = archivedParentFailure(error.message);
    if (parentError) return parentError;
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
    if (error.message.includes('card_pool_ip_mismatch')) {
      return rpcFailure('카드와 같은 IP의 카드풀만 연결할 수 있습니다.');
    }
    if (error.message.includes('pool_rarity_uncovered')) {
      return rpcFailure('현재 풀의 마지막 양수 확률 카드는 이동하거나 해제할 수 없습니다.');
    }
    if (error.message.includes('pooled_card_catalog_contract_locked')) {
      return rpcFailure('풀에 연결된 카드는 먼저 풀을 해제한 뒤 IP·등급을 변경해주세요.');
    }
    if (error.message.includes('pool_not_found')) {
      return rpcFailure('연결할 카드풀을 찾을 수 없습니다.');
    }
    return rpcFailure('카드를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateCatalog(relatedIpPaths(value.ipId, previousIpPath));
  return { message: '카드를 저장했습니다.' };
}

export async function upsertAdminCardPoolAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'cardPool');
  const result = normalizeAdminCardPoolForm(formData, context);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_card_pool', {
    target_operation_id: value.operationId,
    target_pool_id: value.id,
    target_ip_id: value.ipId,
    target_name: value.name,
    target_active_from: value.activeFrom,
    target_active_to: value.activeTo,
  });

  if (error) {
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
    if (error.message.includes('pool_ip_locked')) {
      return rpcFailure('연결된 발급 정책·게임·카드팩·발급 이력이 있어 카드풀 IP를 변경할 수 없습니다.');
    }
    if (error.message.includes('invalid_pool_active_window')) {
      return rpcFailure('운영 종료는 시작보다 뒤여야 합니다.');
    }
    if (error.message.includes('active_reward_policy_window_conflict')) {
      return rpcFailure('활성 발급 정책과 운영 기간이 겹치지 않습니다. 먼저 정책을 비활성화해주세요.');
    }
    if (error.message.includes('game_pool_window_conflict')) {
      return rpcFailure('카드풀 운영 기간은 연결된 게임 운영 기간 전체를 포함해야 합니다.');
    }
    if (error.message.includes('ip_not_found')) {
      return rpcFailure('연결할 IP를 찾을 수 없습니다.');
    }
    if (error.message.includes('operation_conflict')) {
      return rpcFailure('이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    return rpcFailure('카드풀을 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateRewards();
  return { message: '카드풀을 저장했습니다.' };
}

export async function setAdminPoolOddsAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminPoolOddsForm(formData);
  if (!result.ok) return { errors: result.errors };

  const { odds, operationId, poolId } = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_pool_odds', {
    target_operation_id: operationId,
    target_pool_id: poolId,
    target_n: odds.N,
    target_r: odds.R,
    target_sr: odds.SR,
    target_ssr: odds.SSR,
    target_holo: odds.HOLO,
  });

  if (error) {
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
    if (error.message.includes('pool_rarity_uncovered')) {
      return rpcFailure('양수 확률인 모든 등급에 소속 카드가 필요합니다.');
    }
    if (
      error.message.includes('invalid_pool_probability')
      || error.message.includes('invalid_probability_precision')
      || error.message.includes('pool_odds_must_sum_to_one')
    ) {
      return rpcFailure('각 확률과 합계가 올바른지 확인해주세요.');
    }
    if (error.message.includes('pool_not_found')) {
      return rpcFailure('카드풀을 찾을 수 없습니다.');
    }
    if (error.message.includes('operation_conflict')) {
      return rpcFailure('이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    return rpcFailure('등급별 확률을 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateRewards();
  return { message: '등급별 확률을 저장했습니다.' };
}

export async function upsertAdminRewardPolicyAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'rewardPolicy');
  const result = normalizeAdminRewardPolicyForm(formData, context);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_reward_policy', {
    target_operation_id: value.operationId,
    target_policy_id: value.id,
    target_pool_id: value.poolId,
    target_trigger: value.trigger,
    target_ip_id: value.targetIpId,
    target_good_id: value.targetGoodId,
    target_min_amount: value.minAmount,
    target_tickets_per_grant: value.ticketsPerGrant,
    target_active: value.active,
    target_active_from: value.activeFrom,
    target_active_to: value.activeTo,
  });

  if (error) {
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
    if (error.message.includes('card_rewards_disabled')) {
      return rpcFailure('카드 리워드는 현재 비활성화되어 있습니다.');
    }
    if (error.message.includes('auth_required')) {
      return rpcFailure('로그인이 필요합니다.');
    }
    if (error.message.includes('forbidden')) {
      return rpcFailure('관리자 권한이 필요합니다.');
    }
    if (error.message.includes('invalid_operation_id')) {
      return rpcFailure('유효한 저장 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    if (error.message.includes('invalid_reward_policy_id')) {
      return rpcFailure('발급 정책 정보를 확인해주세요.');
    }
    if (error.message.includes('invalid_reward_trigger')) {
      return rpcFailure('지원하지 않는 발급 조건입니다.');
    }
    if (error.message.includes('invalid_min_amount')) {
      return rpcFailure('최소 결제 금액을 확인해주세요.');
    }
    if (error.message.includes('invalid_tickets_per_grant')) {
      return rpcFailure('발급 수량은 1~100 사이여야 합니다.');
    }
    if (error.message.includes('invalid_reward_policy_active_from')) {
      return rpcFailure('운영 시작 일시를 확인해주세요.');
    }
    if (error.message.includes('invalid_reward_policy_active_window')) {
      return rpcFailure('운영 종료는 시작보다 뒤여야 합니다.');
    }
    if (error.message.includes('invalid_reward_policy_active')) {
      return rpcFailure('활성화 설정을 확인해주세요.');
    }
    if (error.message.includes('reward_policy_good_ip_mismatch')) {
      return rpcFailure('선택한 IP의 굿즈만 지정할 수 있습니다.');
    }
    if (error.message.includes('ip_not_found')) {
      return rpcFailure('연결할 IP를 찾을 수 없습니다.');
    }
    if (error.message.includes('good_not_found')) {
      return rpcFailure('연결할 굿즈를 찾을 수 없습니다.');
    }
    if (error.message.includes('pool_not_found')) {
      return rpcFailure('카드풀을 찾을 수 없습니다.');
    }
    if (error.message.includes('reward_pool_not_ready')) {
      return rpcFailure('확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.');
    }
    if (error.message.includes('reward_policy_pool_window_disjoint')) {
      return rpcFailure('정책과 카드풀 운영 기간이 겹쳐야 합니다.');
    }
    if (error.message.includes('reward_policy_pool_locked')) {
      return rpcFailure('이미 발급 이력이 있어 카드풀을 변경할 수 없습니다.');
    }
    if (error.message.includes('operation_conflict')) {
      return rpcFailure('이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    return rpcFailure('발급 정책을 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateRewards();
  return { message: '발급 정책을 저장했습니다.' };
}

export async function upsertAdminGameAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const records = await getAdminCatalogRecords();
  const result = normalizeAdminGameForm(formData, gameContextFromRecords(records));
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_game', {
    target_operation_id: value.operationId,
    target_previous_game_id: value.previousGameId,
    target_game_id: value.id,
    target_title: value.title,
    target_reward_pool_id: value.rewardPoolId,
    target_event_id: value.eventId,
    target_per_user_daily_limit: value.perUserDailyLimit,
    target_active_from: value.activeFrom,
    target_active_to: value.activeTo,
    target_end_now: false,
  });

  if (error) {
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) return archivedError;
    if (error.message.includes('card_rewards_disabled')) {
      return rpcFailure('카드 리워드는 현재 비활성화되어 있습니다.');
    }
    if (error.message.includes('auth_required')) return rpcFailure('로그인이 필요합니다.');
    if (error.message.includes('forbidden')) return rpcFailure('관리자 권한이 필요합니다.');
    if (error.message.includes('invalid_operation_id')) {
      return rpcFailure('유효한 저장 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    if (error.message.includes('invalid_game_id')) return rpcFailure('게임 ID를 확인해주세요.');
    if (error.message.includes('invalid_game_title')) return rpcFailure('게임 제목을 입력해주세요.');
    if (error.message.includes('invalid_game_daily_limit')) {
      return rpcFailure('일일 플레이 한도는 1~100 사이여야 합니다.');
    }
    if (error.message.includes('invalid_game_active_from')) {
      return rpcFailure('운영 시작 일시를 명시적으로 선택해주세요.');
    }
    if (error.message.includes('invalid_game_active_window')) {
      return rpcFailure('운영 종료는 시작보다 뒤여야 합니다.');
    }
    if (error.message.includes('pool_not_found')) return rpcFailure('카드풀을 찾을 수 없습니다.');
    if (error.message.includes('reward_pool_not_ready')) {
      return rpcFailure('확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.');
    }
    if (error.message.includes('game_pool_window_not_covered')) {
      return rpcFailure('게임 운영 기간은 카드풀 운영 기간 안에 있어야 합니다.');
    }
    if (
      error.message.includes('game_event_ip_mismatch')
      || error.message.includes('game_event_mode_invalid')
    ) {
      return rpcFailure('같은 IP의 온라인 이벤트만 선택할 수 있습니다.');
    }
    if (error.message.includes('event_not_found')) return rpcFailure('이벤트를 찾을 수 없습니다.');
    if (error.message.includes('game_catalog_locked')) {
      return rpcFailure('플레이 이력이 있어 ID·카드풀·이벤트·설정을 변경할 수 없습니다.');
    }
    if (error.message.includes('game_variant_read_only')) {
      return rpcFailure('굿즈 보상형 게임은 #115에서 운영합니다.');
    }
    if (error.message.includes('game_id_conflict')) return rpcFailure('이미 사용 중인 게임 ID입니다.');
    if (error.message.includes('game_not_found')) return rpcFailure('게임을 찾을 수 없습니다.');
    if (error.message.includes('operation_conflict')) {
      return rpcFailure('이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    return rpcFailure('게임을 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateGames([value.previousGameId, value.id]);
  return { message: '게임을 저장했습니다.' };
}

export async function endAdminGameAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminGameEndForm(formData);
  if (!result.ok) return { errors: result.errors };

  const { gameId, operationId } = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_game', {
    target_operation_id: operationId,
    target_previous_game_id: gameId,
    target_game_id: gameId,
    target_title: null,
    target_reward_pool_id: null,
    target_event_id: null,
    target_per_user_daily_limit: null,
    target_active_from: null,
    target_active_to: null,
    target_end_now: true,
  });

  if (error) {
    if (error.message.includes('game_not_active')) {
      return rpcFailure('운영 중인 게임만 지금 종료할 수 있습니다.');
    }
    if (error.message.includes('game_variant_read_only')) {
      return rpcFailure('굿즈 보상형 게임은 #115에서 운영합니다.');
    }
    if (error.message.includes('game_not_found')) return rpcFailure('게임을 찾을 수 없습니다.');
    if (error.message.includes('operation_conflict')) {
      return rpcFailure('이미 처리된 종료 요청입니다. 화면을 새로고침해주세요.');
    }
    return rpcFailure('게임 운영을 종료하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateGames([gameId]);
  return { message: '게임 운영을 종료했습니다.' };
}

export async function upsertAdminEventAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'event');
  const result = normalizeAdminEventForm(formData, context);
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
    target_previous_id: value.previousId,
  });

  if (error) {
    const writeIntentError = catalogWriteIntentFailure(error.message);
    if (writeIntentError) return writeIntentError;
    const artworkError = artworkClaimFailure(error.message);
    if (artworkError) return artworkError;
    const parentError = archivedParentFailure(error.message);
    if (parentError) return parentError;
    if (error.message.includes('game_event_contract_locked')) {
      return rpcFailure('연결된 게임이 있어 이벤트 IP·운영 방식을 변경할 수 없습니다.');
    }
    return rpcFailure('이벤트를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateCatalog(relatedIpPaths(value.ipId, previousIpPath));
  return { message: '이벤트를 저장했습니다.' };
}

export async function upsertAdminTicketTypeAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'ticketType');
  const result = normalizeAdminTicketTypeForm(formData, context);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_ticket_type', {
    target_operation_id: value.operationId,
    target_ticket_type_id: value.id,
    target_event_id: value.eventId,
    target_name: value.name,
    target_price: value.price,
    target_capacity: value.capacity,
  });

  if (error) {
    const archivedError = archivedCatalogFailure(error.message);
    if (archivedError) {
      revalidateTicketing();
      return archivedError;
    }
    if (error.message.includes('capacity_below_sold')) {
      revalidateTicketing();
      return rpcFailure('정원은 현재 할당 수량보다 작게 줄일 수 없습니다.');
    }
    if (error.message.includes('ticket_type_catalog_locked')) {
      revalidateTicketing();
      return rpcFailure('예매 이력이 있는 회차는 이벤트·회차명·가격을 변경할 수 없습니다.');
    }
    if (error.message.includes('event_not_found')) {
      revalidateTicketing();
      return rpcFailure('연결할 이벤트를 찾을 수 없습니다.');
    }
    if (error.message.includes('operation_conflict')) {
      revalidateTicketing();
      return rpcFailure('이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    }
    return rpcFailure('티켓 회차를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateTicketing();
  return { message: '티켓 회차를 저장했습니다.' };
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
    if (error.message.includes('account_suspended')) {
      return rpcFailure('정지된 계정에는 staff 또는 admin 역할을 부여할 수 없습니다.');
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

export async function hideCommunityCommentAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminHideCommentForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('admin_hide_community_comment', {
    target_comment_id: result.value.commentId,
    target_report_id: result.value.reportId,
  });

  if (error) return rpcFailure('댓글을 숨김 처리하지 못했습니다. 다시 시도해주세요.');

  revalidateModeration(readRpcIpId(data));
  return { message: '댓글을 숨김 처리했습니다.' };
}
