'use server';

import { goodsLinkedMetadataRpcFields } from '@/lib/admin/goods-linked-metadata';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
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
import { parseGoodsOptionRows } from '@/lib/admin/goods-option-editor';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { goodsSalePolicyRpcFields } from '@/lib/admin/goods-sale-policy';
import {
  normalizeAdminHideCommentForm,
  normalizeAdminHidePostForm,
  normalizeAdminReportStatusForm,
} from '@/lib/admin/moderation';
import { normalizeAdminUserRoleForm } from '@/lib/admin/roles';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { getCatalogSnapshot } from '@/lib/catalog';
import { sendRestockAlertEmails } from '@/lib/email/transactional.server';
import { createClient } from '@/lib/supabase/server';

/*
 * `values`·`attempt` 는 실패한 제출을 폼이 되살리기 위한 값이다(lib/admin/form-state.ts).
 * 성공 응답은 지금처럼 `message` 만 싣는다 — 성공 뒤 폼은 저장된 레코드를 보여야 한다.
 */
export interface AdminCatalogActionState extends AdminFormValuesState {
  savedGoodId?: string;
  stockAdjustment?: { variantId: string; stockQty: number; adjustmentId: string };
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
  const defaults = ['/', '/ip', '/shop', '/shop/new', '/shop/best', '/search', '/binder', '/events', '/offline-popups', '/admin', '/admin/catalog/goods'];
  for (const path of [...defaults, ...paths]) {
    revalidatePath(path);
  }
}

function revalidateStock(ipPath: string | null) {
  const paths = ['/', '/ip', '/shop', '/cart', '/checkout', '/admin', '/admin/catalog/goods'];
  if (ipPath) paths.push(ipPath);
  for (const path of paths) revalidatePath(path);
}

function revalidateTicketing() {
  revalidatePath('/admin');
  revalidatePath('/events');
  revalidatePath('/offline-popups');
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
  paths.push('/offline-popups');
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

/* 폼 검증을 우회해 RPC 까지 닿은 정가 오류를 운영자 언어로 옮긴다 (#326). */
function compareAtPriceFailure(message: string): AdminCatalogActionState | null {
  return message.includes('goods_compare_at_price_invalid')
    ? rpcFailure('소비자가는 기준 판매가보다 커야 해요')
    : null;
}

/*
 * 재입고 알림 발송 (#326).
 *
 * 재고를 건드릴 수 있는 두 액션(굿즈 저장·실재고 조정) 뒤에서 조건 없이 부른다.
 * "품절→판매 가능 전이가 일어났는가"는 DB 트리거가 이미 판정했고, 이미 보낸
 * 사이클은 발송 클레임이 거른다 — 여기서 다시 판정하면 판정이 두 곳으로 갈라진다.
 *
 * 기다리지 않는다. 메일 왕복이 저장 응답을 붙잡으면 운영자 화면이 그만큼 늦고,
 * 메일 실패가 저장 성공을 뒤집어서도 안 된다. 다만 서버리스 런타임은 응답을 돌려준
 * 순간 실행을 얼릴 수 있어, 떠 있는 promise 는 발송 보장이 아니다 — after() 로
 * 응답 이후 수명에 등록해야 클레임·발송까지 살아서 간다. 훅은 절대 throw 하지 않는다.
 */
function notifyRestockSubscribers(goodId: string) {
  after(() => sendRestockAlertEmails(goodId));
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
  const ipIds = new Set(records.ips.filter((record) => !record.archivedAt).map((record) => record.id));
  const context = {
    ...activeContext,
    eventIds: new Set(records.events
      .filter((record) => !record.archivedAt && (!record.ipId || ipIds.has(record.ipId)))
      .map((record) => record.id)),
    goodIpById: new Map(records.goods
      .filter((record) => !record.archivedAt && ipIds.has(record.ipId))
      .map((record) => [record.id, record.ipId])),
    // 준비 중인 초안 IP는 공개 카탈로그에 없다. 신규 연결은 어드민의 미보관 IP로 검증한다.
    ipIds,
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
  state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  /* 실패는 어느 단계에서 나든 제출값을 되돌려 폼이 리셋되지 않게 한다. */
  const fail = (failure: AdminCatalogActionState) => withPreservedFormValues(failure, state, formData);

  let result: ReturnType<typeof normalizeAdminIpForm>;
  try {
    const authError = await requireStaffAction();
    if (authError) return fail(authError);

    const catalog = await getAdminValidationCatalog();
    result = normalizeAdminIpForm(formData, catalogContextFromSnapshot(catalog));
  } catch (error) {
    unstable_rethrow(error);
    return fail(rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.'));
  }
  if (!result.ok) return fail({ errors: result.errors });

  const value = result.value;
  let error: { message: string } | null;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc('admin_upsert_ip', {
      target_id: value.id,
      target_title: value.title,
      target_sub: value.sub,
      target_vertical_key: value.verticalKey,
      target_tagline: value.tagline,
      target_synopsis: value.synopsis,
      target_glyph: value.glyph,
      target_bg: value.bg,
      target_image_path: value.imagePath,
      // Exposure controls own this value; metadata saves preserve the latest DB flag.
      target_featured: null,
      target_previous_id: value.previousId,
      /* null 이면 게시 상태를 건드리지 않는다(신규는 초안). "저장 후 공개"만 true 를 보낸다. */
      target_publish: value.publish,
    }));
  } catch (error) {
    unstable_rethrow(error);
    return fail(rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.'));
  }

  if (error) {
    return fail(
      catalogWriteIntentFailure(error.message)
        ?? artworkClaimFailure(error.message)
        ?? archivedCatalogFailure(error.message)
        ?? rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.'),
    );
  }

  /* 게시 전환은 검색 결과도 바꾼다 — 보관 액션이 비우는 표면과 맞춘다. */
  revalidateCatalog([`/ip/${value.id}`, '/search', '/admin/catalog/ips', `/admin/catalog/ips/${value.id}`]);
  return { message: value.publish ? 'IP를 저장하고 공개했습니다.' : 'IP를 저장했습니다.' };
}

export async function upsertAdminGoodAction(state: AdminCatalogActionState, formData: FormData): Promise<AdminCatalogActionState> {
  try {
    const result = await saveAdminGood(state, formData);
    return result.errors ? withPreservedFormValues(result, state, formData) : result;
  } catch (error) {
    unstable_rethrow(error);
    return withPreservedFormValues(rpcFailure('상품을 저장하지 못했습니다. 다시 시도해주세요.'), state, formData);
  }
}

async function saveAdminGood(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const context = await getAdminValidationContext(formData, 'good');
  const result = normalizeAdminGoodForm(formData, context);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const optionFields: Record<string, unknown> = {};
  if (formData.has('variants')) {
    const options = parseGoodsOptionRows(String(formData.get('variants')), value.price);
    if (!options.ok) return { errors: { variants: options.error } };
    try {
      const baseline = JSON.parse(String(formData.get('variantBaseline') ?? '[]'));
      if (!Array.isArray(baseline) || baseline.length > 100 || baseline.some((id) => typeof id !== 'string')) throw new Error();
      optionFields.variants = options.rows;
      optionFields.variant_baseline = baseline;
    } catch { return { errors: { variants: '옵션 기준값을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요.' } }; }
  }
  const fulfillmentFields: Record<string, unknown> = {};
  if (formData.has('originId')) fulfillmentFields.origin_id = String(formData.get('originId') ?? '').trim() || null;
  if (formData.has('shippingFeeType')) fulfillmentFields.shipping_fee_type = String(formData.get('shippingFeeType'));
  if (formData.has('individualFee')) fulfillmentFields.individual_fee = String(formData.get('individualFee'));
  const previousIpPath = readPreviousIpPath(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_save_good', { target_good: {
    ...optionFields,
    ...fulfillmentFields,
    ...goodsSalePolicyRpcFields(value),
    id: value.id,
    ip_id: value.ipId,
    name: value.name,
    ...(value.nameEn !== undefined ? { name_en: value.nameEn } : {}),
    ...(value.searchKeywords !== undefined ? { search_keywords: value.searchKeywords } : {}),
    ...(value.displayOrder !== undefined ? { display_order: value.displayOrder } : {}),
    ...goodsLinkedMetadataRpcFields(value),
    ...(value.claimPolicy ? { claim_policy: value.claimPolicy } : {}),
    type: value.type,
    price: value.price,
    badge: value.badge,
    stock: value.stock,
    bg: value.bg,
    image_path: value.imagePath,
    notice_maker: value.notice.maker,
    notice_origin: value.notice.origin,
    notice_material: value.notice.material,
    notice_size: value.notice.size,
    notice_made_on: value.notice.madeOn,
    notice_as_manager: value.notice.asManager,
    notice_as_contact: value.notice.asContact,
    description: value.description,
    gallery_paths: value.galleryPaths,
    detail_image_path: value.detailImagePath,
    previous_id: value.previousId,
    compare_at_price: value.compareAtPrice,
    code: value.code,
    default_variant_code: value.defaultVariantCode,
    publish: value.publish,
  } });

  if (error) {
    if (/stock_changed|goods_options_changed/.test(error.message)) return { errors: { variants: '다른 작업에서 옵션이나 재고가 바뀌었습니다. 입력값은 유지됩니다. 최신 내용을 확인하고 다시 저장해주세요.' } };
    if (/goods_kc_reassessment_required|goods_kc_published_edit_requires_draft/.test(error.message)) return { errors: { form: '모델·옵션·고시정보 변경에는 KC 재검토가 필요합니다. 상품을 먼저 초안으로 전환한 뒤 수정해주세요.' } };
    if (error.message.includes('goods_kc_')) return { errors: { form: 'KC 정보에서 실제 모델·옵션과 원본 근거를 확인하고 검토를 완료한 뒤 공개해주세요.' } };
    if (error.message.includes('active_price_period_requires_reset')) return { errors: { price: '활성 기간 할인을 중지한 뒤 기준 판매가나 옵션 판매가를 변경해주세요.' } };
    if (/purchase_limit_not_configured|goods_order_quantity_activation|goods_member_quantity_activation/.test(error.message)) return { errors: { form: '주문당 최소·최대 수량과 회원 한도 수치를 입력한 뒤 해당 한도를 적용해주세요.' } };
    if (/invalid_goods_options/.test(error.message)) return { errors: { variants: '옵션 이름·코드·금액·재고를 확인해주세요.' } };
    if (/invalid_good_origin|fulfillment_origin_required|fulfillment_origin_inactive/.test(error.message)) return { errors: { originId: '공개하려면 활성 출고지를 선택해주세요.' } };
    if (/invalid_good_shipping|invalid_individual_fee/.test(error.message)) return { errors: { shippingFeeType: '배송비 유형과 금액을 확인해주세요.' } };
    if (error.message.includes('goods_publish_incomplete')) return { errors: { form: '상품 유형·대표 이미지·상품정보제공고시와 옵션을 채운 뒤 공개해주세요.' } };
    if (error.message.includes('goods_code_key')) return { errors: { code: '이미 사용 중인 상품코드입니다.' } };
    if (error.message.includes('goods_variants_code_key')) return { errors: { [formData.has('variants') ? 'variants' : 'defaultVariantCode']: '이미 사용 중인 옵션코드입니다.' } };
    if (error.message.includes('goods_slug_locked')) return { errors: { id: '한 번 공개한 상품의 URL은 변경할 수 없습니다.' } };
    if (error.message.includes('goods_pkey')) return { errors: { id: '이미 사용 중인 URL입니다.' } };
    return catalogWriteIntentFailure(error.message)
      ?? artworkClaimFailure(error.message)
      ?? archivedParentFailure(error.message)
      ?? goodsNoticeFailure(error.message)
      ?? compareAtPriceFailure(error.message)
      ?? rpcFailure('굿즈를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  const savedId = typeof data?.id === 'string' ? data.id : value.id;
  if (!savedId) return rpcFailure('상품 저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  notifyRestockSubscribers(savedId);
  revalidateCatalog([...relatedIpPaths(value.ipId, previousIpPath), `/admin/catalog/ips/${value.ipId}`, `/shop/${savedId}`, ...(value.previousId ? [`/shop/${value.previousId}`] : [])]);
  return { message: '굿즈를 저장했습니다.', savedGoodId: savedId };
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
  const { data, error } = await supabase.rpc('admin_adjust_stock', {
    target_adjustment_id: value.adjustmentId,
    target_good_id: value.goodId,
    target_variant_id: value.variantId,
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
    if (error.message.includes('goods_variant_not_found')) return rpcFailure('재고를 조정할 옵션을 찾을 수 없습니다. 최신 옵션 목록을 확인해주세요.');
    if (error.message.includes('good_not_found')) {
      return rpcFailure('굿즈를 찾을 수 없습니다.');
    }
    return rpcFailure('실재고를 조정하지 못했습니다. 다시 시도해주세요.');
  }

  notifyRestockSubscribers(value.goodId);
  revalidateStock(ipPath);
  return { message: '실재고를 조정했습니다.', ...(typeof data === 'number' ? {
    stockAdjustment: { variantId: value.variantId, stockQty: data, adjustmentId: crypto.randomUUID() },
  } : {}) };
}

export async function upsertAdminCardAction(
  state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  return preserveCatalogSubmission(state, formData, () => saveAdminCard(formData),
    '카드를 저장하지 못했습니다. 다시 시도해주세요.');
}

async function preserveCatalogSubmission(
  state: AdminCatalogActionState,
  formData: FormData,
  save: () => Promise<AdminCatalogActionState>,
  failureMessage: string,
): Promise<AdminCatalogActionState> {
  try {
    const result = await save();
    return result.errors ? withPreservedFormValues(result, state, formData) : result;
  } catch (error) {
    unstable_rethrow(error);
    return withPreservedFormValues(rpcFailure(failureMessage), state, formData);
  }
}

async function saveAdminCard(formData: FormData): Promise<AdminCatalogActionState> {
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
  state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  return preserveCatalogSubmission(state, formData, () => saveAdminCardPool(formData),
    '카드풀을 저장하지 못했습니다. 다시 시도해주세요.');
}

async function saveAdminCardPool(formData: FormData): Promise<AdminCatalogActionState> {
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
      return rpcFailure('legacy 굿즈 게임은 읽기 전용이며 현 로드맵에서 운영하지 않습니다.');
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
      return rpcFailure('legacy 굿즈 게임은 읽기 전용이며 현 로드맵에서 운영하지 않습니다.');
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
  state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  return preserveCatalogSubmission(state, formData, () => saveAdminEvent(formData),
    '이벤트를 저장하지 못했습니다. 다시 시도해주세요.');
}

async function saveAdminEvent(formData: FormData): Promise<AdminCatalogActionState> {
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
