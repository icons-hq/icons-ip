'use server';
import { readGoodsSalePeriod } from '@/lib/admin/goods-sale-period';
import { INSTANT_DISCOUNT_PERIOD_FIELD, parseInstantDiscountPeriodRequest } from '@/lib/admin/goods-price-editor';
import { readGoodsAttributeSubmission } from '@/lib/admin/goods-attributes';

import { readAdminGoodsCustomInputs } from '@/lib/admin/goods-custom-inputs';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { goodSaveFields } from '@/lib/admin/good-save';
import { goodsDraftIdentity, goodsDraftError, type GoodsDraftIdentity } from '@/lib/admin/goods-drafts';
import {
  GOOD_WORKSPACE_OPERATION_FIELD, GOOD_WORKSPACE_SECTIONS_FIELD, goodWorkspacePublishRejection, goodWorkspaceSectionFailure, parseGoodWorkspaceSections,
  type GoodWorkspaceRpcSections,
} from '@/lib/admin/good-workspace-sections';
import { canAccessAdminScreen } from '@/lib/admin/access';
import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import {
  GOOD_BADGES_INVALID_MESSAGE,
  GOODS_DETAIL_IMAGE_MAX,
  catalogContextFromSnapshot,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminIpForm,
  normalizeAdminStockAdjustmentForm,
  normalizeAdminTicketTypeForm,
  type AdminFieldErrors,
} from '@/lib/admin/catalog';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { parseGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { goodsKcPublishBlockedMessage, parseAdminGoodsKc } from '@/lib/admin/goods-kc';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  normalizeAdminHideCommentForm,
  normalizeAdminHidePostForm,
  normalizeAdminReportStatusForm,
} from '@/lib/admin/moderation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { sendRestockAlertEmails } from '@/lib/email/transactional.server';
import type { AdminCapability } from '@/lib/admin/access';
import { loadGoodsIpOptions } from '@/lib/admin/goods-list.server';
import { createClient } from '@/lib/supabase/server';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';
import { IP_PUBLIC_SLUG_ERROR_MESSAGES } from '@/lib/ip-identity';
import { GOOD_OPTION_LIMIT_ERROR_FIELD, goodCategoryFailure } from '@/lib/admin/good-workspace';
import { GOODS_BASE_REVISION_INVALID_MESSAGE, goodBaseRevisionFailure, readGoodBaseRevision } from '@/lib/admin/goods-base-revision';

/*
 * `values`·`attempt` 는 실패한 제출을 폼이 되살리기 위한 값이다(lib/admin/form-state.ts).
 * 성공 응답은 지금처럼 `message` 만 싣는다 — 성공 뒤 폼은 저장된 레코드를 보여야 한다.
 */
export interface AdminCatalogActionState extends AdminFormValuesState {
  savedGoodId?: string;
  /** 새 IP 등록이 발급한 내부 ID. 등록 화면은 이 IP 상세로 옮겨 간다. */
  savedIpId?: string;
  /** [실제 등록](intent=publish)이 KC 검토에 막혀 같은 입력을 초안으로만 저장했다. `message`가 그 이유다. */
  kcPublishBlocked?: true;
  /** 새 상품의 [실제 등록]이 KC 밖의 공개 조건에 막혀 저장만 했다(T15b). `message`가 그 이유다. */
  publishBlocked?: true;
  /** 등록 화면 원자 저장이 KC 섹션을 함께 저장했다. 첫 저장 뒤 KC 유형 틀을 다시 얹지 않는다. */
  workspaceKcSaved?: true;
  stockAdjustment?: { variantId: string; stockQty: number; adjustmentId: string };
  errors?: AdminFieldErrors & { form?: string };
  message?: string;
}

async function requireStaffAction(capability: AdminCapability = 'platform.manage'): Promise<AdminCatalogActionState | null> {
  return await requireAdminActionAccess('/admin', { capability }) ? null : { errors: { form: '관리자 권한이 필요합니다.' } };
}

/* 역할 부여·회수는 staff가 아니라 admin 전용 — RPC도 내부에서 재검사한다. */
async function requireAdminAction(): Promise<AdminCatalogActionState | null> {
  return await requireAdminActionAccess('/admin', { adminOnly: true }) ? null : { errors: { form: '최고 관리자 권한이 필요합니다.' } };
}

function revalidateCatalog(paths: string[]) {
  revalidateGoodsSurfaces();
  const defaults = ['/events', '/offline-popups'];
  for (const path of [...defaults, ...paths]) {
    revalidatePath(path);
  }
}

function revalidateStock(ipPath: string | null) {
  revalidateGoodsSurfaces();
  if (ipPath) revalidatePath(ipPath);
}

function revalidateTicketing() {
  revalidatePath('/admin');
  revalidatePath('/events');
  revalidatePath('/offline-popups');
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
  if (message.includes('goods_detail_images')) {
    return rpcFailure(`긴 상세 이미지는 최대 ${GOODS_DETAIL_IMAGE_MAX}장까지 저장할 수 있습니다. 긴 상세 이미지 목록에서 남는 이미지를 빼고 다시 저장해주세요.`);
  }
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
    ? rpcFailure('할인은 0원보다 크고 판매가보다 작아야 해요. 판매가와 할인을 확인해주세요.')
    : null;
}

/*
 * D5② 랜덤 판매 상품의 조건(옵션 2개 이상·같은 가격·같은 옵션 배정 상한·직접입력 없음 등)을 깨는 저장은 DB가 커밋에서
 * random_option_*로 거절한다. 직접입력 조건은 직접입력 칸, 배정 상한은 구매 제한 카드의 옵션별 제한, 나머지는 옵션 칸에 이유를 붙인다.
 */
function randomOptionSaleModeFailure(message: string): AdminCatalogActionState | null {
  const problem = RANDOM_OPTION_PROBLEMS.find((code) => message.includes(code));
  if (!problem) return null;
  const field = problem === 'random_option_custom_inputs' ? 'customInputs'
    : problem === 'random_option_limit_mismatch' ? GOOD_OPTION_LIMIT_ERROR_FIELD : 'variants';
  return { errors: { [field]: goodsOptionSaleModeErrorMessage(problem) } };
}

const ERP_IDENTITY_TAKEN = {
  erpCode: '이미 다른 옵션에 연결된 ERP 코드입니다.',
  barcode: '이미 다른 옵션에 연결된 바코드입니다.',
} as const;
const ERP_IDENTITY_TAKEN_GUIDANCE = '한 ERP 품목은 옵션 하나에만 연결할 수 있습니다. 다른 상품의 옵션이 쓰고 있으면 그 옵션에서 먼저 비우고, 두 옵션의 ERP 품목을 맞바꾸려면 한쪽을 비우고 저장한 뒤 다시 지정해주세요. 입력값은 유지됩니다.';

/*
 * ERP 코드·바코드는 옵션 전체에서 대소문자 구분 없이 하나뿐이다(전역 unique). 같은 상품의 두 옵션,
 * 다른 상품·보관된 옵션, 한 번에 맞바꾼 두 옵션이 모두 이 위반으로 끝나므로 옵션 칸에 원인을 알린다.
 * Postgres DETAIL의 값은 lower()라 제출한 옵션에서 원래 표기와 옵션 이름을 찾는다.
 */
function erpIdentityTakenFailure(error: { message: string; details?: unknown }, rows: readonly GoodsOptionRow[], field: string): AdminCatalogActionState | null {
  const column = error.message.includes('goods_variant_external_identity_erp_code_key') ? 'erpCode'
    : error.message.includes('goods_variant_external_identity_barcode_key') ? 'barcode' : null;
  if (!column) return null;
  const value = /=\((.*)\) already exists/.exec(typeof error.details === 'string' ? error.details : '')?.[1];
  const row = value === undefined ? undefined : rows.find((option) => option[column]?.trim().toLowerCase() === value);
  const target = row ? ` 확인할 옵션: ${row.name}(${row[column]?.trim()}).` : '';
  return { errors: { [field]: `${ERP_IDENTITY_TAKEN[column]}${target} ${ERP_IDENTITY_TAKEN_GUIDANCE}` } };
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

type AdminValidationRecordKind = 'good' | 'event' | 'ticketType';

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

async function getAdminValidationContext(
  formData: FormData,
  kind: AdminValidationRecordKind,
) {
  const [catalog, records, goodIpOptions] = await Promise.all([
    getAdminValidationCatalog(),
    getAdminCatalogRecords(kind === 'good' ? { include: ['goods'] } : {}),
    kind === 'good' ? loadGoodsIpOptions() : Promise.resolve(null),
  ]);
  const activeContext = catalogContextFromSnapshot(catalog);
  const ipIds = new Set((goodIpOptions ?? records.ips).filter((record) => !record.archivedAt).map((record) => record.id));
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
  const fields = {
    target_title: value.title,
    target_sub: value.sub,
    target_vertical_key: value.verticalKey,
    target_tagline: value.tagline,
    target_synopsis: value.synopsis,
    target_glyph: value.glyph,
    target_bg: value.bg,
    target_image_path: value.imagePath,
    /* null 이면 게시 상태를 건드리지 않는다(신규는 초안). "저장 후 공개"만 true 를 보낸다. */
    target_publish: value.publish,
  };
  let data: unknown = null;
  let error: { message: string } | null;
  try {
    const supabase = await createClient();
    /* 새 IP는 내부 ID를 보내지 않는다 — admin_create_ip가 공개 URL로 발급해 돌려준다(S36-003 · ADR-0039). */
    ({ data, error } = value.previousId === null
      ? await supabase.rpc('admin_create_ip', { target_public_slug: value.publicSlug, ...fields })
      : await supabase.rpc('admin_upsert_ip', {
        target_id: value.id,
        ...fields,
        // Exposure controls own this value; metadata saves preserve the latest DB flag.
        target_featured: null,
        target_previous_id: value.previousId,
      }));
  } catch (error) {
    unstable_rethrow(error);
    return fail(rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.'));
  }

  if (error) {
    return fail(
      ipCreateFailure(error.message)
        ?? catalogWriteIntentFailure(error.message)
        ?? artworkClaimFailure(error.message)
        ?? archivedCatalogFailure(error.message)
        ?? rpcFailure('IP를 저장하지 못했습니다. 다시 시도해주세요.'),
    );
  }

  const savedId = value.previousId === null
    ? (typeof data === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(data) ? data : null)
    : value.id;
  /* 등록은 됐지만 발급된 ID를 읽지 못했다 — 다시 저장하면 같은 공개 URL로 중복 등록을 시도하게 되므로 입력을 되살리지 않는다. */
  if (!savedId) return rpcFailure('IP를 등록했지만 결과를 확인하지 못했습니다. IP 목록에서 확인해주세요.');

  /* 게시 전환은 검색 결과도 바꾼다 — 보관 액션이 비우는 표면과 맞춘다. */
  revalidateCatalog([
    `/ip/${savedId}`, ...(value.publicSlug && value.publicSlug !== savedId ? [`/ip/${value.publicSlug}`] : []),
    '/search', '/admin/catalog/ips', `/admin/catalog/ips/${savedId}`,
  ]);
  if (value.previousId === null) {
    return { message: value.publish ? 'IP를 등록하고 공개했습니다.' : 'IP를 등록했습니다.', savedIpId: savedId };
  }
  return { message: value.publish ? 'IP를 저장하고 공개했습니다.' : 'IP를 저장했습니다.' };
}

/* 새 IP 등록(admin_create_ip)의 거절을 입력 칸 옆에 운영자 말로 붙인다. */
function ipCreateFailure(message: string): AdminCatalogActionState | null {
  if (message.includes('ip_public_slug_taken')) {
    return { errors: { publicSlug: '이미 사용 중인 공개 URL입니다. 다른 주소를 입력해주세요.' } };
  }
  if (message.includes('invalid_ip_public_slug')) return { errors: { publicSlug: IP_PUBLIC_SLUG_ERROR_MESSAGES.format } };
  if (message.includes('invalid_ip_title')) return { errors: { title: 'IP 이름을 입력해주세요.' } };
  if (message.includes('invalid_ip_vertical')) return { errors: { verticalKey: '등록된 IP 분류를 선택해주세요.' } };
  if (message.includes('ip_directory_conflict')) return rpcFailure('다른 운영자가 IP 노출 순서를 저장하는 중입니다. 잠시 후 다시 저장해주세요.');
  return null;
}

/* 섹션 입력(KC 근거 참조 포함)과 작업 ID는 화면의 키 밖 상태가 보존한다. 실패 상태 값에 되싣지 않는다. */
const GOOD_WORKSPACE_FORM_FIELDS = [GOOD_WORKSPACE_SECTIONS_FIELD, GOOD_WORKSPACE_OPERATION_FIELD];

export async function upsertAdminGoodAction(state: AdminCatalogActionState, formData: FormData): Promise<AdminCatalogActionState> {
  try {
    const result = await saveAdminGood(state, formData);
    return result.errors ? withPreservedFormValues(result, state, formData, { exclude: GOOD_WORKSPACE_FORM_FIELDS }) : { ...result, attempt: (state.attempt ?? 0) + 1 };
  } catch (error) {
    unstable_rethrow(error);
    return withPreservedFormValues(rpcFailure('상품을 저장하지 못했습니다. 다시 시도해주세요.'), state, formData, { exclude: GOOD_WORKSPACE_FORM_FIELDS });
  }
}

async function saveAdminGood(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const auth = await requireAdminActionAccess('/admin', { capability: 'catalog.manage' });
  if (!auth) return { errors: { form: '관리자 권한이 필요합니다.' } };

  const serverDraft = goodsDraftIdentity(formData);
  if (serverDraft === 'invalid') return { errors: { form: '임시저장 정보를 확인하지 못했습니다. 임시저장을 다시 불러와주세요.' } };
  const context = await getAdminValidationContext(formData, 'good');
  const result = normalizeAdminGoodForm(formData, context);
  if (!result.ok) return { errors: result.errors };

  const value = result.value;
  const attributes = readGoodsAttributeSubmission(formData);
  if (!attributes.ok) return { errors: { productAttributes: attributes.error } };
  const salePeriod = readGoodsSalePeriod(formData);
  if (!salePeriod.ok) return { errors: { saleStartsAt: salePeriod.error } };
  const customInputs = readAdminGoodsCustomInputs(formData);
  if (!customInputs.ok) return {errors:{customInputs:customInputs.error}};
  /* TKT-033(ADR-0040): 즉시할인 기간 지시. 상품 편집이 다루지 않는 할인 상태면 화면이 보내지 않는다(지시 없는 저장). */
  /* CAT-027: 편집 화면이 연 시점의 상품 기본 칸 버전. 저장된 상품을 고칠 때만 싣고, 없으면(옛 화면) 지금처럼 비교 없이 저장한다. */
  const baseRevision = readGoodBaseRevision(formData);
  if (baseRevision === 'invalid') return { errors: { form: GOODS_BASE_REVISION_INVALID_MESSAGE } };
  const instantDiscountPeriod = parseInstantDiscountPeriodRequest(formData.get(INSTANT_DISCOUNT_PERIOD_FIELD));
  if (!instantDiscountPeriod) return { errors: { discountPeriod: '즉시할인 기간을 확인하지 못했습니다. 새로고침한 뒤 다시 저장해주세요. 입력은 유지됩니다.' } };
  const optionFields: Record<string, unknown> = {};
  let optionRows: GoodsOptionRow[] = [];
  if (formData.has('variants')) {
    const options = parseGoodsOptionRows(String(formData.get('variants')), value.price);
    if (!options.ok) return { errors: { variants: options.error } };
    optionRows = options.rows;
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
  /*
   * 등록 화면(R13·D6②·T15b)은 작업 ID와 KC·예약판매·나머지 설정 섹션을 함께 보낸다. 작업 ID가 있으면 기본 입력과 섹션을
   * admin_save_good_workspace 한 트랜잭션으로 저장한다(재시도 중복 방지 영수증 포함). 작업 ID가 없는
   * 수정 화면·이전 화면은 지금처럼 admin_save_good으로 저장한다. 새 상품의 [실제 등록](0901-008)은 래퍼가 저장을 끝낸 뒤
   * 같은 요청에서 기존 공개 경로로 시도하고, 거절되면 저장은 남기고 거절 이유를 영수증(publish)에 싣는다.
   */
  const workspaceOperation = formData.get(GOOD_WORKSPACE_OPERATION_FIELD);
  let workspaceSections: GoodWorkspaceRpcSections | null = null;
  if (workspaceOperation !== null) {
    if (!isUuid(workspaceOperation)) return { errors: { form: '저장 요청을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요. 입력은 유지됩니다.' } };
    if (value.publish && value.previousId) return { errors: { form: '저장된 상품은 판매 준비의 게시 상태에서 공개해주세요.' } };
    const sections = parseGoodWorkspaceSections(formData.get(GOOD_WORKSPACE_SECTIONS_FIELD),
      canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true }));
    if (!sections.ok) return { errors: { [sections.field]: sections.error } };
    workspaceSections = sections.sections;
  }
  const previousIpPath = readPreviousIpPath(formData);
  const supabase = await createClient();
  const targetGood = {
    ...optionFields,
    ...salePeriod.fields,
    ...customInputs.fields,
    ...attributes.fields,
    ...fulfillmentFields,
    ...goodSaveFields(value),
    default_variant_code: value.defaultVariantCode,
    ...(instantDiscountPeriod === 'absent' ? {} : { instant_discount_period: instantDiscountPeriod }),
    ...(baseRevision !== null && value.previousId ? { base_expected_revision: baseRevision } : {}),
  };
  let { data, error } = workspaceSections
    ? await supabase.rpc('admin_save_good_workspace', { p_request: { operationId: workspaceOperation, good: targetGood, draft: serverDraft, sections: workspaceSections } })
    : await saveGoodWithServerDraft(supabase, targetGood, serverDraft);
  let kcPublishBlocked: string | null = null;
  if (!workspaceSections && error && value.publish === true && error.message.includes('goods_kc_review_required')) {
    const draft = await saveDraftAfterKcPublishBlock(supabase, targetGood, value.previousId, serverDraft);
    if (draft) ({ data, error, message: kcPublishBlocked } = draft);
  }

  if (error) {
    /* 다른 작업이 그사이 기본 칸을 바꿨다. 무엇도 저장하지 않았고 입력은 유지된다(옛 값으로 되돌리지 않는다). */
    const baseFailure = goodBaseRevisionFailure(error.message);
    if (baseFailure) return { errors: { form: baseFailure } };
    const sectionFailure = workspaceSections ? goodWorkspaceSectionFailure(error.message, error.code) : null;
    if (sectionFailure) return { errors: sectionFailure as AdminFieldErrors };
    if (/goods_group_common_owned_by_group|goods_group_name_owned_by_group|goods_group_identity_immutable|goods_group_single_variant_required/.test(error.message)) return { errors: { form: '그룹의 공통정보 또는 옵션 구성은 그룹상품에서 수정해주세요. 입력은 유지됩니다. 최신 상품 상태를 다시 확인해주세요.' } };
    if (/goods_aggregation_policy_owned_by_root|goods_aggregation_policy_owned/.test(error.message)) return { errors: { form: '합산 배송·구매수량 조건은 합산 기준 상품에서 수정해주세요. 최신 상품 상태를 다시 확인해주세요.' } };
    if (/shipping_charge_group_origin_mismatch/.test(error.message)) return { errors: { originId: '현재 배송비 묶음그룹과 출고지가 다릅니다. 묶음그룹 배정을 먼저 해제하거나 배송정보 템플릿에서 출고지와 그룹을 함께 적용해주세요. 입력은 유지됩니다.' } };
    if (/goods_sale_period_changed/.test(error.message)) return { errors: { saleStartsAt: '다른 작업에서 판매기간이 바뀌었습니다. 입력은 유지됩니다. 새로고침 후 최신 기간을 확인해주세요.' } };
    if (/goods_sale_period_preorder_conflict/.test(error.message)) return { errors: { saleStartsAt: '예약판매 옵션은 일반 판매기간과 함께 사용할 수 없습니다. 예약판매를 일반재고로 전환하거나 판매기간을 설정안함으로 변경해주세요.' } };
    if (/invalid_goods_sale_period/.test(error.message)) return { errors: { saleStartsAt: '판매 시작·종료 시각을 확인해주세요.' } };
    if (/goods_attributes_changed|goods_attribute_schema_changed/.test(error.message)) return { errors: { productAttributes: '다른 작업에서 이 카테고리의 상품속성 항목이나 이 상품의 속성 값이 바뀌었습니다. 입력은 유지됩니다. 지금 입력을 따로 적어 둔 뒤 새로고침해 바뀐 속성을 확인하고 다시 저장해주세요.' } };
    if (/goods_attribute_required/.test(error.message)) return { errors: { productAttributes: '현재 대표 카테고리의 필수 상품속성을 입력해주세요.' } };
    if (/invalid_goods_attribute|goods_attribute_retained_limit/.test(error.message)) return { errors: { productAttributes: '상품속성 값을 확인해주세요. 선택형은 목록에 있는 값만 고를 수 있고, 숫자는 소수점 아래 6자리까지 넣을 수 있습니다. 카테고리를 바꾸기 전에 넣고 저장하지 않은 속성 값은 그 카테고리로 돌아가 저장하거나, 상품속성 칸의 보관값 목록에서 지운 뒤 저장해주세요.' } };
    if (/goods_draft_/.test(error.message)) return { errors: { form: goodsDraftError(error.message) } };
    if (/goods_custom_inputs_changed/.test(error.message)) return { errors:{customInputs:'다른 작업에서 직접입력형 옵션 설정이 바뀌었습니다. 입력값은 유지됩니다. 새로고침 후 설정을 확인해주세요.'} };
    if (/invalid_goods_custom_input/.test(error.message)) return { errors:{customInputs:'직접입력형 옵션명과 사용여부를 확인해주세요.'} };
    if (/category_not_leaf|category_archived|category_not_found|invalid_good_category|invalid_additional_categories/.test(error.message)) return { errors: { form: '고른 카테고리가 바뀌었거나 연결할 수 없는 상태입니다. 대표·추가 카테고리를 다시 골라주세요. 사용 중인 맨 아래 단계 카테고리만 고를 수 있습니다. 입력값은 유지됩니다.' } };
    const categoryFailure = goodCategoryFailure(error.message);
    if (categoryFailure) return { errors: { categoryId: `${categoryFailure} 입력값은 유지됩니다.` } };
    /* 표시문구 저장 거절(허용 값 밖·같은 값 두 번·첫 값 불일치, 20261125140000)은 폼·엑셀 검증을 우회한 경우뿐이다. 그 칸에 고칠 방법을 붙인다. */
    if (/goods_badges_invalid|goods_badges_duplicate|goods_badges_allowed|goods_badge_check/.test(error.message)) return { errors: { badge: GOOD_BADGES_INVALID_MESSAGE } };
    if (/goods_description_/.test(error.message)) return { errors: { description: '상세페이지를 저장하지 못했습니다. 상세페이지 형식, 글자 수(쓸 수 없는 태그를 정리한 뒤 기준), 상세페이지에 올린 이미지 20장 제한을 확인해주세요. 입력한 원문은 유지됩니다.' } };
    const randomOptionFailure = randomOptionSaleModeFailure(error.message);
    if (randomOptionFailure) return randomOptionFailure;
    if (/stock_changed|goods_options_changed|goods_variant_external_identity_changed/.test(error.message)) return { errors: { variants: '다른 작업에서 옵션이나 재고가 바뀌었습니다. 입력값은 유지됩니다. 최신 내용을 확인하고 다시 저장해주세요.' } };
    if (/goods_kc_reassessment_required|goods_kc_published_edit_requires_draft/.test(error.message)) return { errors: { form: '모델·옵션·고시정보 변경에는 KC 재검토가 필요합니다. 상품을 먼저 초안으로 전환한 뒤 수정해주세요.' } };
    if (error.message.includes('goods_kc_')) return { errors: { form: "KC 정보에서 검토를 완료한 뒤 공개해주세요. KC 대상이 아니면 '상품 전체 KC 해당 없음'으로 바로 끝낼 수 있습니다." } };
    const instantDiscountFailure = instantDiscountPeriodFailure(error.message);
    if (instantDiscountFailure) return { errors: instantDiscountFailure };
    if (error.message.includes('active_price_period_requires_reset')) return { errors: { price: '진행 중이거나 예정된 기간 할인(할인 프로모션 포함)이 있어 판매가·옵션가를 바꾸지 않았습니다. 그 할인을 먼저 중지해주세요.' } };
    if (/purchase_limit_not_configured|goods_order_quantity_activation|goods_member_quantity_activation/.test(error.message)) return { errors: { minOrderQty: '구매 제한을 설정하려면 최소·최대 구매수량 또는 1인 최대 구매수량을 모두 입력해주세요.' } };
    if (/invalid_goods_options/.test(error.message)) return { errors: { variants: '옵션 이름·코드·금액·재고·옵션별 구매 제한(양의 정수)을 확인해주세요.' } };
    if (/invalid_good_origin|fulfillment_origin_required|fulfillment_origin_inactive/.test(error.message)) return { errors: { originId: '공개하려면 사용 중인 출고지를 골라주세요.' } };
    if (/invalid_good_shipping|invalid_individual_fee/.test(error.message)) return { errors: { shippingFeeType: '배송비 유형과 금액을 확인해주세요.' } };
    if (error.message.includes('goods_publish_incomplete')) return { errors: { form: '대표 이미지·상품정보제공고시와 옵션을 채운 뒤 공개해주세요.' } };
    if (error.message.includes('goods_code_key')) return { errors: { code: '이미 사용 중인 상품 자동코드입니다.' } };
    if (error.message.includes('goods_variants_code_key')) return { errors: { [formData.has('variants') ? 'variants' : 'defaultVariantCode']: '이미 사용 중인 옵션코드입니다.' } };
    const erpIdentityError = erpIdentityTakenFailure(error, optionRows, formData.has('variants') ? 'variants' : 'form');
    if (erpIdentityError) return erpIdentityError;
    if (error.message.includes('goods_slug_locked')) return { errors: { id: '한 번 공개한 상품의 URL은 변경할 수 없습니다.' } };
    if (error.message.includes('goods_pkey')) return { errors: { id: '이미 사용 중인 URL입니다.' } };
    return catalogWriteIntentFailure(error.message)
      ?? artworkClaimFailure(error.message)
      ?? archivedParentFailure(error.message)
      ?? goodsNoticeFailure(error.message)
      ?? compareAtPriceFailure(error.message)
      ?? rpcFailure(adminGoodsCopy('굿즈를 저장하지 못했습니다. 다시 시도해주세요.'));
  }

  const savedId = typeof data?.id === 'string' ? data.id : value.id;
  if (!savedId) return rpcFailure('상품 저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  notifyRestockSubscribers(savedId);
  revalidateCatalog([...relatedIpPaths(value.ipId, previousIpPath), `/admin/catalog/ips/${value.ipId}`, `/shop/${savedId}`, ...(value.previousId ? [`/shop/${value.previousId}`] : [])]);
  if (data?.draftAlreadyCompleted) return { message: '이미 상품으로 등록한 임시저장입니다. 저장된 상품을 확인해주세요.', savedGoodId: savedId };
  if (kcPublishBlocked) return { message: kcPublishBlocked, kcPublishBlocked: true, savedGoodId: savedId };
  const workspaceKcSaved = workspaceSections && data?.kc ? { workspaceKcSaved: true as const } : {};
  /* T15b: 새 상품의 [실제 등록]이 거절되면 저장은 끝났다. 성공으로 알리지 않고 저장만 했다는 것과 공개를 막은 이유를 보인다. */
  const publishRejection = workspaceSections && value.publish ? goodWorkspacePublishRejection(data?.publish) : null;
  if (publishRejection) return { message: publishRejection.message, savedGoodId: savedId, ...workspaceKcSaved,
    ...(publishRejection.kc ? { kcPublishBlocked: true as const } : { publishBlocked: true as const }) };
  return { message: value.publish ? adminGoodsCopy('굿즈를 저장하고 공개했습니다.') : adminGoodsCopy('굿즈를 저장했습니다.'), savedGoodId: savedId, ...workspaceKcSaved };
}

type AdminSupabase = Awaited<ReturnType<typeof createClient>>;

/** TKT-033(ADR-0040): 즉시할인 기간 저장의 DB 거절을 즉시할인 블록(기간 칸)에 붙인다. 입력은 유지된다. */
function instantDiscountPeriodFailure(message: string): AdminFieldErrors | null {
  if (message.includes('instant_discount_period_changed')) return { discountPeriod: '다른 곳에서 이 상품의 할인을 걸거나 멈췄습니다. 입력은 유지됩니다. 새로고침해 최신 할인을 확인한 뒤 다시 저장해주세요.' };
  if (message.includes('instant_discount_period_managed')) return { discountPeriod: '할인 프로모션이나 기간 할인에서 관리하는 할인이 있어 즉시할인을 바꾸지 않았습니다. 그 할인을 먼저 확인해주세요.' };
  if (message.includes('instant_discount_period_conflict')) return { discountValue: '진행 중이거나 예정된 기간 할인이 있는 상품에는 기간 없는 즉시할인을 함께 걸 수 없습니다. 특정기간만 할인으로 바꾸거나 기간 할인을 먼저 중지해주세요.' };
  if (message.includes('instant_discount_period_ended')) return { discountPeriod: '할인 종료 시각이 이미 지났습니다. 종료를 지금 이후로 입력해주세요.' };
  if (message.includes('instant_discount_period_price_invalid')) return { discountValue: '기간 할인 금액은 가장 낮은 옵션 판매 금액보다 작아야 합니다(옵션마다 같은 금액을 뺍니다).' };
  if (message.includes('invalid_instant_discount_period')) return { discountPeriod: '할인 시작·종료를 KST로 모두 입력해주세요. 종료는 시작보다 늦어야 합니다.' };
  if (message.includes('price_period_overlap')) return { discountPeriod: '같은 기간에 걸린 다른 기간 할인(끝난 할인 포함)과 겹칩니다. 시작을 지금 이후로 바꾸거나 기간을 다시 확인해주세요.' };
  return null;
}

function saveGoodWithServerDraft(supabase: AdminSupabase, targetGood: Record<string, unknown>, draft: GoodsDraftIdentity | null) {
  return draft ? supabase.rpc('admin_save_good_from_draft', { target_good: targetGood, p_draft_id: draft.id, p_draft_revision: draft.revision })
    : supabase.rpc('admin_save_good', { target_good: targetGood });
}


async function readGoodsKcState(supabase: AdminSupabase, goodId: string | null) {
  if (!goodId) return null;
  try {
    const { data, error } = await supabase.rpc('admin_read_goods_kc', { p_good_id: goodId });
    return error ? null : parseAdminGoodsKc(data);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/*
 * [실제 등록](intent=publish)의 KC 거절(goods_kc_review_required)은 admin_save_good 안에서 저장을 마친 뒤
 * 마지막 공개 전환이 낸다. RPC 하나가 트랜잭션이라 첫 호출은 저장까지 모두 되돌려졌으므로,
 * 공개 전환만 뺀 같은 전체 입력을 초안으로 다시 저장해 입력을 잃지 않게 한다. 저장 전 KC 상태는
 * 첫 호출이 되돌려진 지금 읽어야 이번 저장이 검토를 무효화했는지 구분할 수 있다.
 * 다시 저장이 실패하면 아무것도 저장되지 않았으므로 null을 돌려 원래 KC 오류를 유지한다.
 */
async function saveDraftAfterKcPublishBlock(supabase: AdminSupabase, targetGood: Record<string, unknown>, previousId: string | null, serverDraft: GoodsDraftIdentity | null = null) {
  const before = await readGoodsKcState(supabase, previousId);
  let retry: Awaited<ReturnType<AdminSupabase['rpc']>>;
  try {
    retry = await saveGoodWithServerDraft(supabase, { ...targetGood, publish: null }, serverDraft);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  if (retry.error) return null;
  const savedId = typeof retry.data?.id === 'string' ? retry.data.id : null;
  const after = await readGoodsKcState(supabase, savedId);
  return { data: retry.data, error: null, message: goodsKcPublishBlockedMessage(before, after) };
}

export async function adjustAdminStockAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaffAction('catalog.manage');
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
      return rpcFailure('이 재고 조정은 이미 처리됐습니다. 새로고침해 최신 수량을 확인한 뒤, 더 조정할 것이 있을 때만 다시 조정해주세요.');
    }
    if (error.message.includes('stock_out_of_range')) {
      return rpcFailure('재고는 0개 미만이거나 허용 범위를 넘도록 조정할 수 없습니다.');
    }
    if (error.message.includes('goods_variant_not_found')) return rpcFailure('재고를 조정할 옵션을 찾을 수 없습니다. 최신 옵션 목록을 확인해주세요.');
    if (error.message.includes('good_not_found')) {
      return rpcFailure(adminGoodsCopy('굿즈를 찾을 수 없습니다.'));
    }
    return rpcFailure('실재고를 조정하지 못했습니다. 다시 시도해주세요.');
  }

  notifyRestockSubscribers(value.goodId);
  revalidateStock(ipPath);
  return { message: '실재고를 조정했습니다.', ...(typeof data === 'number' ? {
    stockAdjustment: { variantId: value.variantId, stockQty: data, adjustmentId: crypto.randomUUID() },
  } : {}) };
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
      return rpcFailure('예전 게임 기록이 연결돼 이벤트 IP·운영 방식을 변경할 수 없습니다. 개발팀에 게임 기록 정리를 요청해주세요.');
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
      return rpcFailure('정원은 지금까지 예매된 수량(결제 대기 포함)보다 작게 줄일 수 없습니다.');
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
      return rpcFailure('이 저장 요청은 이미 다른 내용으로 처리됐습니다. 화면을 새로고침해 저장된 내용을 확인한 뒤, 바꿀 것이 남았으면 다시 저장해주세요.');
    }
    return rpcFailure('티켓 회차를 저장하지 못했습니다. 다시 시도해주세요.');
  }

  revalidateTicketing();
  return { message: '티켓 회차를 저장했습니다.' };
}

/** Legacy raw-role mutation is retired; explicit manager assignments own authorization. */
export async function setAdminUserRoleAction(
  _state: AdminCatalogActionState,
  _formData: FormData,
): Promise<AdminCatalogActionState> {
  void _state; void _formData;
  const authError = await requireAdminAction();
  if (authError) return authError;
  return rpcFailure('매니저 관리에서 매니저 권한을 변경해주세요.');
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
