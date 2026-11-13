import { isGoodsShipDate } from '@/lib/goods-preorders';
import { isUuid } from '@/lib/uuid';
import { ORDER_DELAY_STATUS_LABELS, type OrderDelayChannelStatus } from './order-delay-notices';

/*
 * QNA-040(11/11 결정 "상품 단위 일괄 안내"): 예약 상품의 발송 예정일이 바뀌면 그 상품의 미출고 예약 배송 건 일정을 한 번에 바꾸고
 * 미리보기 뒤 앱 알림·이메일(SMS는 켜졌을 때)로 안내한다. 안내는 기존 지연 안내 원장(kind='preorder_schedule')에 주문마다 남는다.
 * 서버 응답(admin_preview/apply/read_goods_preorder_schedule_change)은 고객 이메일·이름·연락처를 싣지 않는다 — 주문번호·배송 건·날짜·채널 결과뿐이다.
 */

/**
 * DB 한도(admin_apply_goods_preorder_schedule_change). 한 번에 바꾸는 배송 건 수. 로컬 실측(11/12): 3,000건 확정 약 1.5초·
 * 미리보기 약 60ms·응답 1.4MB — authenticated 8초 문장 한도 안이다. 넘으면 화면이 주문번호 순 앞의 N건만 먼저 고른다.
 */
export const PREORDER_SCHEDULE_LIMIT = 3000;
export const PREORDER_SCHEDULE_TITLE_MAX = 80;
export const PREORDER_SCHEDULE_BODY_MAX = 350;
export const PREORDER_SCHEDULE_REASON_MAX = 2000;
/** 운영자가 뺄 수 있는 배송 건 수의 서버 상한(대상 수까지 — 상한을 넘는 대상의 나머지를 자동으로 뺀다). */
export const PREORDER_SCHEDULE_EXCLUDED_MAX = 50000;

export const PREORDER_SCHEDULE_EXCLUSION_REASONS = [
  'cancellation_in_progress', 'other_preorder', 'unchanged', 'exported', 'not_open', 'shipped', 'canceled',
] as const;
export type PreorderScheduleExclusionReason = (typeof PREORDER_SCHEDULE_EXCLUSION_REASONS)[number];
export const PREORDER_SCHEDULE_EXCLUSION_LABELS: Record<PreorderScheduleExclusionReason, string> = {
  cancellation_in_progress: '취소 처리 중',
  other_preorder: '다른 예약 상품과 함께 발송(그 상품의 예정일보다 앞당길 수 없음)',
  unchanged: '이미 같은 발송 예정일(안내함)',
  exported: '출고지시됨',
  not_open: '진행 중인 주문 아님',
  shipped: '발송됨',
  canceled: '취소됨',
};

export interface PreorderScheduleTarget {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  shipmentLabel: string;
  originName: string;
  orderStatus: string;
  paymentMethod: string;
  currentDate: string;
  originalDate: string;
  /** 고객이 마지막으로 안내받은 날짜(마지막 일괄 변경의 날짜, 없으면 주문 당시 날짜). 안내 문구의 이전 날짜다. */
  knownDate: string;
  newDate: string;
  /** 일정은 그대로 두고 안내만 한다 — 주문 상세에서 따로 바꾼 날짜가 새 날짜와 같지만 고객은 아직 모른다. */
  noticeOnly: boolean;
  /** 운영자가 주문 상세에서 배송 건마다 바꾼 날짜가 지금 날짜다. 기본 포함, 화면에서 뺄 수 있다. */
  individuallyChanged: boolean;
  /** 같은 배송 건에 다른 예약 상품이 함께 있다. 늦출 때 새 날짜는 그 상품의 주문 당시 예정일 이상이다. */
  otherPreorder: boolean;
  version: number;
}
export interface PreorderScheduleExcluded {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  shipmentLabel: string;
  originName: string;
  orderStatus: string;
  currentDate: string | null;
  reason: PreorderScheduleExclusionReason;
}
/** 접수 중(또는 접수 예정)인 예약 조건 중 새 날짜와 다른 것. 이 조건으로 들어오는 새 주문은 이 날짜로 약속된다. */
export interface PreorderScheduleOpenPolicy {
  variantId: string;
  variantName: string;
  policyId: string;
  revision: number;
  expectedShipDate: string;
  startsAt: string;
  endsAt: string;
  remainingQty: number;
}
export type PreorderSchedulePolicyBlock = 'before_sale_end' | 'random_option_state';
export const PREORDER_SCHEDULE_POLICY_BLOCK_LABELS: Record<PreorderSchedulePolicyBlock, string> = {
  before_sale_end: '새 발송 예정일이 접수 종료일보다 빨라 예약 조건을 바꿀 수 없습니다. 접수 기간부터 조정해야 합니다.',
  random_option_state: '랜덤 판매 옵션 중 접수 중지·물량 소진된 옵션이 있어 모든 옵션을 한 번에 바꿀 수 없습니다.',
};
export type PreorderSchedulePolicyMode = 'replace' | 'acknowledge';
export interface PreorderSchedulePreview {
  goodId: string;
  goodName: string;
  randomSale: boolean;
  variantId: string | null;
  variantName: string | null;
  /** 판매 중인 옵션 수. 상한을 넘을 때 '옵션별로 나누기'를 안내할지 정한다. */
  variantCount: number;
  expectedShipDate: string;
  fingerprint: string;
  targets: PreorderScheduleTarget[];
  /** 최대 500줄. 사유별 전체 건수는 excludedCounts. */
  excluded: PreorderScheduleExcluded[];
  excludedCounts: Partial<Record<PreorderScheduleExclusionReason, number>>;
  excludedTotal: number;
  targetShipments: number;
  targetOrders: number;
  openPolicies: PreorderScheduleOpenPolicy[];
  policyBlockReason: PreorderSchedulePolicyBlock | null;
  /** 이 운영자가 접수 중 조건을 새 날짜로 교체할 수 있다(활성화 권한: 계정 주매니저·통합 매니저). */
  canReplacePolicies: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  limit: number;
}
export type PreorderScheduleSmsStatus = 'queued' | 'processing' | 'sent' | 'failed' | 'unknown' | 'skipped';
export interface PreorderScheduleChangedShipment {
  shipmentId: string;
  label: string;
  originName: string;
  fromDate: string;
  toDate: string;
  noticeOnly: boolean;
}
export interface PreorderScheduleChangeTarget {
  id: string;
  orderId: string;
  orderNumber: string;
  audience: 'payer' | 'recipient';
  hasEmail: boolean;
  shipments: PreorderScheduleChangedShipment[];
  inAppStatus: 'prepared' | 'sent';
  emailStatus: OrderDelayChannelStatus;
  emailProviderState: string | null;
  errorCode: string | null;
  retryable: boolean;
  smsStatus: PreorderScheduleSmsStatus | null;
  smsReason: string | null;
}
export interface PreorderScheduleChange {
  id: string;
  goodId: string;
  goodName: string;
  variantId: string | null;
  variantName: string | null;
  expectedShipDate: string;
  reason: string;
  title: string;
  customerBody: string;
  actorName: string | null;
  createdAt: string;
  noticeId: string;
  requestedAt: string | null;
  emailEnabled: boolean;
  smsQueued: boolean;
  shipmentCount: number;
  orderCount: number;
  excludedCount: number;
  /** 접수 중 예약 조건을 새 날짜로 바꿨는지(replaced), 그대로 두기로 확인했는지(acknowledged). 해당 없으면 null. */
  policyAction: 'replaced' | 'acknowledged' | null;
  policies: { variantName: string; expectedShipDate: string }[];
  targets: PreorderScheduleChangeTarget[];
}
export interface PreorderScheduleChangeSummary {
  id: string;
  expectedShipDate: string;
  variantName: string | null;
  createdAt: string;
  actorName: string | null;
  shipmentCount: number;
  orderCount: number;
  requestedAt: string | null;
}

export const PREORDER_SCHEDULE_SMS_LABELS: Record<PreorderScheduleSmsStatus, string> = {
  queued: '발송 대기', processing: '처리 중', sent: '발송', failed: '실패', unknown: '결과 불명', skipped: '발송 제외',
};
export const PREORDER_SCHEDULE_SMS_REASON_LABELS: Record<string, string> = {
  sms_disabled: 'SMS 알림 설정이 꺼져 있습니다.',
  consent_required: 'SMS 수신 동의가 없습니다.',
  no_verified_phone: '인증된 휴대폰 번호가 없습니다.',
  account_unavailable: '이용할 수 없는 계정입니다.',
  target_changed: '안내 뒤 배송 건이 나가거나 일정이 다시 바뀌었습니다.',
  expired: '하루가 지나 보내지 않았습니다.',
  provider_unavailable: '문자 발송사가 요청을 처리하지 못했습니다. 다시 보내지 않습니다.',
  invalid_body: '문자 본문을 만들 수 없습니다.',
  lease_expired: '발송 결과를 확인하지 못했습니다. 중복을 막기 위해 다시 보내지 않습니다.',
};

/** 고객 안내 기본 문구. 선물 받는 분에게도 같은 글이 가므로 '주문하신'처럼 주문자만 가리키는 말을 쓰지 않는다. 고객에게 가는 글이라 굿즈명을 그대로 쓰고 '상품'이라는 운영 어휘를 넣지 않는다. */
export function defaultPreorderScheduleCopy(goodName: string): { title: string; body: string } {
  const name = goodName.trim();
  return {
    title: '예약 주문 발송 일정 변경 안내',
    body: `'${name}' 예약 배송의 발송 예정일이 변경되었습니다. 기다려 주셔서 감사드리며, 바뀐 일정에 맞춰 준비해 보내드리겠습니다.`
      .slice(0, PREORDER_SCHEDULE_BODY_MAX),
  };
}

export function preorderScheduleError(code: string): string {
  const errors: Record<string, string> = {
    invalid_preorder_schedule_change: '새 발송 예정일(오늘 이후)·변경 사유·고객 안내 제목과 내용을 확인해주세요.',
    good_not_found: '상품을 찾을 수 없습니다. 목록에서 다시 열어주세요.',
    goods_variant_not_found: '선택한 옵션을 찾을 수 없습니다. 옵션을 다시 골라주세요.',
    preorder_schedule_random_whole_good: '랜덤 판매 상품은 옵션 하나만 바꿀 수 없습니다. 상품 전체의 예약 주문을 함께 바꿉니다.',
    preorder_schedule_stale: '미리보기 뒤 예약 주문이나 예약 조건이 바뀌었습니다(새 주문·배송 건 변경 등). 대상을 다시 미리 본 뒤 확정해주세요.',
    preorder_schedule_no_targets: '바꿀 예약 배송 건이 없습니다. 제외 사유를 확인해주세요.',
    preorder_schedule_too_many: `한 번에 바꿀 수 있는 배송 건은 ${PREORDER_SCHEDULE_LIMIT.toLocaleString('ko-KR')}건까지입니다. 앞의 건부터 나누어 바꿔주세요.`,
    preorder_schedule_idempotency_conflict: '같은 요청의 내용이 바뀌었습니다. 대상을 다시 미리 본 뒤 확정해주세요.',
    preorder_schedule_change_not_found: '일정 변경 기록을 찾을 수 없습니다.',
    preorder_schedule_policy_decision_required: '접수 중인 예약 조건을 새 날짜로 바꿀지, 그대로 둘지 골라주세요.',
    preorder_schedule_policy_not_replaceable: '접수 중인 예약 조건을 새 날짜로 바꿀 수 없습니다. 그대로 두기를 확인하거나 예약 조건을 먼저 조정해주세요.',
    preorder_admin_required: '접수 중인 예약 조건은 계정 주매니저·통합 매니저만 바꿀 수 있습니다. 그대로 두기를 확인해주세요.',
    preorder_policy_changed: '예약 조건이 다른 화면에서 바뀌었습니다. 대상을 다시 미리 본 뒤 확정해주세요.',
    preorder_policy_not_configured: '예약 조건을 새 날짜로 활성화할 수 없습니다. 접수 기간과 발송 예정일을 확인해주세요.',
    delay_notice_delivery_disabled: '지연 안내 이메일 발송 설정이 꺼져 있어 일정 변경과 안내를 진행할 수 없습니다.',
    delay_notice_not_found: '안내 기록을 찾을 수 없습니다.',
  };
  return errors[code] ?? '처리 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인한 뒤 다시 시도해주세요.';
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const count = (value: unknown, max = PREORDER_SCHEDULE_LIMIT * 2): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalInstant = (value: unknown) => value === null || instant(value);
const exclusion = (value: unknown): value is PreorderScheduleExclusionReason => (PREORDER_SCHEDULE_EXCLUSION_REASONS as readonly unknown[]).includes(value);
const policyBlock = (value: unknown): value is PreorderSchedulePolicyBlock => Object.hasOwn(PREORDER_SCHEDULE_POLICY_BLOCK_LABELS, String(value));

function parseTarget(value: unknown): PreorderScheduleTarget | null {
  if (!object(value) || !isUuid(value.shipmentId) || !isUuid(value.orderId) || !text(value.orderNumber) || !text(value.shipmentLabel)
    || !text(value.originName) || !text(value.orderStatus) || !text(value.paymentMethod) || !isGoodsShipDate(value.currentDate)
    || !isGoodsShipDate(value.originalDate) || !isGoodsShipDate(value.knownDate) || !isGoodsShipDate(value.newDate)
    || typeof value.noticeOnly !== 'boolean' || typeof value.individuallyChanged !== 'boolean' || typeof value.otherPreorder !== 'boolean'
    /* 같은 날짜는 '안내만'(개별 변경을 처음 알림)일 때만 대상이다. */
    || (value.newDate === value.currentDate) !== value.noticeOnly || (value.noticeOnly && !value.individuallyChanged)
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)) return null;
  return {
    shipmentId: value.shipmentId, orderId: value.orderId, orderNumber: value.orderNumber, shipmentLabel: value.shipmentLabel,
    originName: value.originName, orderStatus: value.orderStatus, paymentMethod: value.paymentMethod, currentDate: value.currentDate,
    originalDate: value.originalDate, knownDate: value.knownDate, newDate: value.newDate, noticeOnly: value.noticeOnly,
    individuallyChanged: value.individuallyChanged, otherPreorder: value.otherPreorder, version: value.version,
  };
}
function parseExcluded(value: unknown): PreorderScheduleExcluded | null {
  if (!object(value) || !isUuid(value.shipmentId) || !isUuid(value.orderId) || !text(value.orderNumber) || !text(value.shipmentLabel)
    || !text(value.originName) || !text(value.orderStatus) || (value.currentDate !== null && !isGoodsShipDate(value.currentDate))
    || !exclusion(value.reason)) return null;
  return {
    shipmentId: value.shipmentId, orderId: value.orderId, orderNumber: value.orderNumber, shipmentLabel: value.shipmentLabel,
    originName: value.originName, orderStatus: value.orderStatus, currentDate: value.currentDate as string | null, reason: value.reason,
  };
}
function parseOpenPolicy(value: unknown): PreorderScheduleOpenPolicy | null {
  if (!object(value) || !isUuid(value.variantId) || !text(value.variantName) || !isUuid(value.policyId) || !count(value.revision, 2147483647)
    || !isGoodsShipDate(value.expectedShipDate) || !instant(value.startsAt) || !instant(value.endsAt) || !count(value.remainingQty, 2147483647)) return null;
  return {
    variantId: value.variantId, variantName: value.variantName, policyId: value.policyId, revision: value.revision,
    expectedShipDate: value.expectedShipDate, startsAt: value.startsAt, endsAt: value.endsAt, remainingQty: value.remainingQty,
  };
}
function parseList<T>(value: unknown, parse: (row: unknown) => T | null, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const rows: T[] = [];
  for (const row of value) {
    const parsed = parse(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

/** 불완전한 미리보기는 대상이 맞는지 알 수 없으니 확정 화면을 열지 않는다(fail closed). */
export function parsePreorderSchedulePreview(value: unknown): PreorderSchedulePreview | null {
  if (!object(value) || !text(value.goodId) || !text(value.goodName) || typeof value.randomSale !== 'boolean'
    || (value.variantId !== null && !isUuid(value.variantId)) || !optionalText(value.variantName) || !count(value.variantCount, 10000)
    || !isGoodsShipDate(value.expectedShipDate) || !text(value.fingerprint) || !/^[0-9a-f]{32}$/.test(value.fingerprint)
    || typeof value.emailEnabled !== 'boolean' || typeof value.smsEnabled !== 'boolean' || typeof value.canReplacePolicies !== 'boolean'
    || (value.policyBlockReason !== null && !policyBlock(value.policyBlockReason))
    || !count(value.targetShipments, Number.MAX_SAFE_INTEGER) || !count(value.targetOrders, Number.MAX_SAFE_INTEGER)
    || !count(value.excludedTotal, Number.MAX_SAFE_INTEGER) || !count(value.limit) || !object(value.excludedCounts)) return null;
  const targets = parseList(value.targets, parseTarget, Number.MAX_SAFE_INTEGER);
  const excluded = parseList(value.excluded, parseExcluded, 500);
  const policies = parseList(value.openPolicies, parseOpenPolicy, 500);
  if (!targets || !excluded || !policies || targets.length !== value.targetShipments
    || new Set(targets.map((target) => target.orderId)).size !== value.targetOrders) return null;
  const excludedCounts: Partial<Record<PreorderScheduleExclusionReason, number>> = {};
  for (const [reason, total] of Object.entries(value.excludedCounts)) {
    if (!exclusion(reason) || !count(total, Number.MAX_SAFE_INTEGER)) return null;
    excludedCounts[reason] = total;
  }
  return {
    goodId: value.goodId, goodName: value.goodName, randomSale: value.randomSale, variantId: value.variantId as string | null,
    variantName: value.variantName as string | null, variantCount: value.variantCount, expectedShipDate: value.expectedShipDate,
    fingerprint: value.fingerprint, targets, excluded, excludedCounts, excludedTotal: value.excludedTotal, targetShipments: value.targetShipments,
    targetOrders: value.targetOrders, openPolicies: policies, policyBlockReason: value.policyBlockReason as PreorderSchedulePolicyBlock | null,
    canReplacePolicies: value.canReplacePolicies, emailEnabled: value.emailEnabled, smsEnabled: value.smsEnabled, limit: value.limit,
  };
}

function parseChangedShipment(value: unknown): PreorderScheduleChangedShipment | null {
  if (!object(value) || !isUuid(value.shipmentId) || !text(value.label) || !text(value.originName)
    || !isGoodsShipDate(value.fromDate) || !isGoodsShipDate(value.toDate) || typeof value.noticeOnly !== 'boolean'
    || value.noticeOnly !== (value.fromDate === value.toDate)) return null;
  return { shipmentId: value.shipmentId, label: value.label, originName: value.originName, fromDate: value.fromDate, toDate: value.toDate, noticeOnly: value.noticeOnly };
}
function parseChangeTarget(value: unknown): PreorderScheduleChangeTarget | null {
  if (!object(value) || !isUuid(value.id) || !isUuid(value.orderId) || !text(value.orderNumber)
    || (value.audience !== 'payer' && value.audience !== 'recipient') || typeof value.hasEmail !== 'boolean'
    || !['prepared', 'sent'].includes(String(value.inAppStatus)) || !Object.hasOwn(ORDER_DELAY_STATUS_LABELS, String(value.emailStatus))
    || !optionalText(value.emailProviderState) || !optionalText(value.errorCode) || typeof value.retryable !== 'boolean'
    || (value.smsStatus !== null && !Object.hasOwn(PREORDER_SCHEDULE_SMS_LABELS, String(value.smsStatus))) || !optionalText(value.smsReason)) return null;
  const shipments = parseList(value.shipments, parseChangedShipment, PREORDER_SCHEDULE_LIMIT);
  if (!shipments || !shipments.length) return null;
  return {
    id: value.id, orderId: value.orderId, orderNumber: value.orderNumber, audience: value.audience, hasEmail: value.hasEmail, shipments,
    inAppStatus: value.inAppStatus as 'prepared' | 'sent', emailStatus: value.emailStatus as OrderDelayChannelStatus,
    emailProviderState: value.emailProviderState as string | null, errorCode: value.errorCode as string | null, retryable: value.retryable,
    smsStatus: value.smsStatus as PreorderScheduleSmsStatus | null, smsReason: value.smsReason as string | null,
  };
}

/** 확정 영수증. 일부만 읽힌 응답을 성공으로 보이지 않는다. */
export function parsePreorderScheduleChange(value: unknown): PreorderScheduleChange | null {
  if (!object(value) || !isUuid(value.id) || !text(value.goodId) || !text(value.goodName) || (value.variantId !== null && !isUuid(value.variantId))
    || !optionalText(value.variantName) || !isGoodsShipDate(value.expectedShipDate) || !text(value.reason) || !text(value.title)
    || !text(value.customerBody) || !optionalText(value.actorName) || !instant(value.createdAt) || !isUuid(value.noticeId)
    || !optionalInstant(value.requestedAt) || typeof value.emailEnabled !== 'boolean' || typeof value.smsQueued !== 'boolean'
    || !count(value.shipmentCount) || value.shipmentCount < 1 || !count(value.orderCount) || value.orderCount < 1
    || !count(value.excludedCount, Number.MAX_SAFE_INTEGER)
    || (value.policyAction !== null && value.policyAction !== 'replaced' && value.policyAction !== 'acknowledged')) return null;
  const targets = parseList(value.targets, parseChangeTarget, PREORDER_SCHEDULE_LIMIT * 2);
  const policies = parseList(value.policies, (row) => object(row) && text(row.variantName) && isGoodsShipDate(row.expectedShipDate)
    ? { variantName: row.variantName, expectedShipDate: row.expectedShipDate } : null, 500);
  if (!targets || !targets.length || !policies || new Set(targets.map((target) => target.orderId)).size !== value.orderCount) return null;
  return {
    id: value.id, goodId: value.goodId, goodName: value.goodName, variantId: value.variantId as string | null, variantName: value.variantName as string | null,
    expectedShipDate: value.expectedShipDate, reason: value.reason, title: value.title, customerBody: value.customerBody,
    actorName: value.actorName as string | null, createdAt: value.createdAt, noticeId: value.noticeId, requestedAt: value.requestedAt as string | null,
    emailEnabled: value.emailEnabled, smsQueued: value.smsQueued, shipmentCount: value.shipmentCount, orderCount: value.orderCount,
    excludedCount: value.excludedCount, policyAction: value.policyAction as PreorderScheduleChange['policyAction'], policies, targets,
  };
}

export function parsePreorderScheduleChangeSummaries(value: unknown): PreorderScheduleChangeSummary[] | null {
  return parseList(value, (row) => object(row) && isUuid(row.id) && isGoodsShipDate(row.expectedShipDate) && optionalText(row.variantName)
    && instant(row.createdAt) && optionalText(row.actorName) && count(row.shipmentCount) && count(row.orderCount) && optionalInstant(row.requestedAt)
    ? {
      id: row.id, expectedShipDate: row.expectedShipDate, variantName: row.variantName as string | null, createdAt: row.createdAt,
      actorName: row.actorName as string | null, shipmentCount: row.shipmentCount, orderCount: row.orderCount, requestedAt: row.requestedAt as string | null,
    } : null, 20);
}

/** 새 날짜가 입력한 날짜와 다른 대상(다른 예약 상품의 주문 당시 예정일까지 늦춰짐) — 드러내고 기본 해제한다. */
export function preorderScheduleDateDiffers(preview: Pick<PreorderSchedulePreview, 'expectedShipDate'>, target: PreorderScheduleTarget): boolean {
  return !target.noticeOnly && target.newDate !== preview.expectedShipDate;
}

/**
 * 처음 미리볼 때 빼 두는 배송 건: 새 날짜가 입력과 다른 대상, 그리고 상한을 넘으면 주문번호 순으로 앞의 N건 뒤의 나머지.
 * 다시 미리보면 바뀐 건은 '이미 같은 발송 예정일'로 빠져 남은 건만 이어 처리한다.
 */
export function defaultPreorderScheduleExclusions(preview: Pick<PreorderSchedulePreview, 'targets' | 'expectedShipDate' | 'limit'>): Set<string> {
  const excluded = new Set(preview.targets.filter((target) => preorderScheduleDateDiffers(preview, target)).map((target) => target.shipmentId));
  let taken = 0;
  for (const target of preview.targets) {
    if (excluded.has(target.shipmentId)) continue;
    if (taken >= preview.limit) excluded.add(target.shipmentId); else taken++;
  }
  return excluded;
}

/** 미리보기의 대상 중 운영자가 뺀 배송 건을 뺀 나머지. 확정 버튼의 건수와 서버에 보내는 제외 목록이 같은 계산을 쓴다. */
export function preorderScheduleSelection(preview: Pick<PreorderSchedulePreview, 'targets'>, excluded: ReadonlySet<string>) {
  const included = preview.targets.filter((target) => !excluded.has(target.shipmentId));
  return {
    included,
    excludedShipmentIds: preview.targets.filter((target) => excluded.has(target.shipmentId)).map((target) => target.shipmentId).sort(),
    shipments: included.length,
    orders: new Set(included.map((target) => target.orderId)).size,
    noticeOnly: included.filter((target) => target.noticeOnly).length,
  };
}

/** 고객 안내에 붙는 날짜 줄(DB 문구와 같은 규칙) — 이전 날짜는 고객이 마지막으로 안내받은 날짜다. */
export function preorderScheduleDateLine(fromDates: readonly string[], toDates: readonly string[]): string {
  const from = [...new Set(fromDates)].sort();
  const to = [...new Set(toDates)].sort();
  if (from.length === 1 && to.length === 1) return `발송 예정일: ${from[0]} → ${to[0]}`;
  return `변경된 발송 예정일: ${to[0]}${to.length > 1 ? ` ~ ${to[to.length - 1]}` : ''}`;
}
