import { isGoodsShipDate } from '@/lib/goods-preorders';
import { isUuid } from '@/lib/uuid';
import { ORDER_DELAY_STATUS_LABELS, type OrderDelayChannelStatus } from './order-delay-notices';

/*
 * QNA-040(11/11 결정 "상품 단위 일괄 안내"): 예약 상품의 발송 예정일이 바뀌면 그 상품의 미출고 예약 배송 건 일정을 한 번에 바꾸고
 * 미리보기 뒤 앱 알림·이메일(SMS는 켜졌을 때)로 안내한다. 안내는 기존 지연 안내 원장(kind='preorder_schedule')에 주문마다 남는다.
 * 서버 응답(admin_preview/apply/read_goods_preorder_schedule_change)은 고객 이메일·이름·연락처를 싣지 않는다 — 주문번호·배송 건·날짜·채널 결과뿐이다.
 */

/** DB 한도(admin_apply_goods_preorder_schedule_change). 한 번에 바꾸는 배송 건 수. */
export const PREORDER_SCHEDULE_LIMIT = 2000;
export const PREORDER_SCHEDULE_TITLE_MAX = 80;
export const PREORDER_SCHEDULE_BODY_MAX = 350;
export const PREORDER_SCHEDULE_REASON_MAX = 2000;

export const PREORDER_SCHEDULE_EXCLUSION_REASONS = [
  'cancellation_in_progress', 'other_preorder', 'unchanged', 'exported', 'not_open', 'shipped', 'canceled',
] as const;
export type PreorderScheduleExclusionReason = (typeof PREORDER_SCHEDULE_EXCLUSION_REASONS)[number];
export const PREORDER_SCHEDULE_EXCLUSION_LABELS: Record<PreorderScheduleExclusionReason, string> = {
  cancellation_in_progress: '취소 처리 중',
  other_preorder: '다른 예약 상품과 함께 발송(앞당기지 않음)',
  unchanged: '이미 같은 발송 예정일',
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
  newDate: string;
  /** 운영자가 주문 상세에서 배송 건마다 바꾼 날짜가 지금 날짜다. 기본 포함, 화면에서 뺄 수 있다. */
  individuallyChanged: boolean;
  /** 같은 배송 건에 다른 예약 상품이 함께 있다. 새 날짜는 그 상품의 주문 당시 예정일보다 앞서지 않는다. */
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
export interface PreorderSchedulePolicyNotice {
  variantId: string;
  variantName: string;
  expectedShipDate: string;
  startsAt: string;
  endsAt: string;
}
export interface PreorderSchedulePreview {
  goodId: string;
  goodName: string;
  randomSale: boolean;
  variantId: string | null;
  variantName: string | null;
  expectedShipDate: string;
  fingerprint: string;
  targets: PreorderScheduleTarget[];
  /** 최대 500줄. 사유별 전체 건수는 excludedCounts. */
  excluded: PreorderScheduleExcluded[];
  excludedCounts: Partial<Record<PreorderScheduleExclusionReason, number>>;
  excludedTotal: number;
  targetShipments: number;
  targetOrders: number;
  /** 접수 중(또는 접수 예정)인 예약 조건 중 새 날짜와 다른 것 — 이후 새 주문은 그 날짜로 안내된다. */
  acceptingPolicies: PreorderSchedulePolicyNotice[];
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

/** 고객 안내 기본 문구. 고객에게 가는 글이라 굿즈명을 그대로 쓰고 '상품'이라는 운영 어휘를 넣지 않는다. */
export function defaultPreorderScheduleCopy(goodName: string): { title: string; body: string } {
  const name = goodName.trim();
  return {
    title: '예약 주문 발송 일정 변경 안내',
    body: `주문하신 '${name}'의 발송 예정일이 변경되었습니다. 기다려 주셔서 감사드리며, 바뀐 일정에 맞춰 준비해 보내드리겠습니다.`
      .slice(0, PREORDER_SCHEDULE_BODY_MAX),
  };
}

export function preorderScheduleError(code: string): string {
  const errors: Record<string, string> = {
    invalid_preorder_schedule_change: '새 발송 예정일(오늘 이후)·변경 사유·고객 안내 제목과 내용을 확인해주세요.',
    good_not_found: '상품을 찾을 수 없습니다. 목록에서 다시 열어주세요.',
    goods_variant_not_found: '선택한 옵션을 찾을 수 없습니다. 옵션을 다시 골라주세요.',
    preorder_schedule_random_whole_good: '랜덤 판매 상품은 옵션 하나만 바꿀 수 없습니다. 상품 전체의 예약 주문을 함께 바꿉니다.',
    preorder_schedule_stale: '미리보기 뒤 예약 주문이 바뀌었습니다(새 주문·배송 건 변경 등). 대상을 다시 미리 본 뒤 확정해주세요.',
    preorder_schedule_no_targets: '바꿀 예약 배송 건이 없습니다. 제외 사유를 확인해주세요.',
    preorder_schedule_too_many: `한 번에 바꿀 수 있는 배송 건은 ${PREORDER_SCHEDULE_LIMIT.toLocaleString('ko-KR')}건까지입니다. 옵션별로 나누어 바꿔주세요.`,
    preorder_schedule_idempotency_conflict: '같은 요청의 내용이 바뀌었습니다. 대상을 다시 미리 본 뒤 확정해주세요.',
    preorder_schedule_change_not_found: '일정 변경 기록을 찾을 수 없습니다.',
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

function parseTarget(value: unknown): PreorderScheduleTarget | null {
  if (!object(value) || !isUuid(value.shipmentId) || !isUuid(value.orderId) || !text(value.orderNumber) || !text(value.shipmentLabel)
    || !text(value.originName) || !text(value.orderStatus) || !text(value.paymentMethod) || !isGoodsShipDate(value.currentDate)
    || !isGoodsShipDate(value.originalDate) || !isGoodsShipDate(value.newDate) || value.newDate === value.currentDate
    || typeof value.individuallyChanged !== 'boolean' || typeof value.otherPreorder !== 'boolean'
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)) return null;
  return {
    shipmentId: value.shipmentId, orderId: value.orderId, orderNumber: value.orderNumber, shipmentLabel: value.shipmentLabel,
    originName: value.originName, orderStatus: value.orderStatus, paymentMethod: value.paymentMethod, currentDate: value.currentDate,
    originalDate: value.originalDate, newDate: value.newDate, individuallyChanged: value.individuallyChanged, otherPreorder: value.otherPreorder,
    version: value.version,
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
    || (value.variantId !== null && !isUuid(value.variantId)) || !optionalText(value.variantName) || !isGoodsShipDate(value.expectedShipDate)
    || !text(value.fingerprint) || !/^[0-9a-f]{32}$/.test(value.fingerprint) || typeof value.emailEnabled !== 'boolean'
    || typeof value.smsEnabled !== 'boolean' || !count(value.targetShipments, Number.MAX_SAFE_INTEGER) || !count(value.targetOrders, Number.MAX_SAFE_INTEGER)
    || !count(value.excludedTotal, Number.MAX_SAFE_INTEGER) || !count(value.limit) || !object(value.excludedCounts)) return null;
  const targets = parseList(value.targets, parseTarget, Number.MAX_SAFE_INTEGER);
  const excluded = parseList(value.excluded, parseExcluded, 500);
  const policies = parseList(value.acceptingPolicies, (row) => object(row) && isUuid(row.variantId) && text(row.variantName)
    && isGoodsShipDate(row.expectedShipDate) && instant(row.startsAt) && instant(row.endsAt)
    ? { variantId: row.variantId, variantName: row.variantName, expectedShipDate: row.expectedShipDate, startsAt: row.startsAt, endsAt: row.endsAt } : null, 500);
  if (!targets || !excluded || !policies || targets.length !== value.targetShipments
    || new Set(targets.map((target) => target.orderId)).size !== value.targetOrders) return null;
  const excludedCounts: Partial<Record<PreorderScheduleExclusionReason, number>> = {};
  for (const [reason, total] of Object.entries(value.excludedCounts)) {
    if (!exclusion(reason) || !count(total, Number.MAX_SAFE_INTEGER)) return null;
    excludedCounts[reason] = total;
  }
  return {
    goodId: value.goodId, goodName: value.goodName, randomSale: value.randomSale, variantId: value.variantId as string | null,
    variantName: value.variantName as string | null, expectedShipDate: value.expectedShipDate, fingerprint: value.fingerprint,
    targets, excluded, excludedCounts, excludedTotal: value.excludedTotal, targetShipments: value.targetShipments,
    targetOrders: value.targetOrders, acceptingPolicies: policies, emailEnabled: value.emailEnabled, smsEnabled: value.smsEnabled,
    limit: value.limit,
  };
}

function parseChangedShipment(value: unknown): PreorderScheduleChangedShipment | null {
  if (!object(value) || !isUuid(value.shipmentId) || !text(value.label) || !text(value.originName)
    || !isGoodsShipDate(value.fromDate) || !isGoodsShipDate(value.toDate)) return null;
  return { shipmentId: value.shipmentId, label: value.label, originName: value.originName, fromDate: value.fromDate, toDate: value.toDate };
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
    || !count(value.excludedCount, Number.MAX_SAFE_INTEGER)) return null;
  const targets = parseList(value.targets, parseChangeTarget, PREORDER_SCHEDULE_LIMIT * 2);
  if (!targets || !targets.length || new Set(targets.map((target) => target.orderId)).size !== value.orderCount) return null;
  return {
    id: value.id, goodId: value.goodId, goodName: value.goodName, variantId: value.variantId as string | null, variantName: value.variantName as string | null,
    expectedShipDate: value.expectedShipDate, reason: value.reason, title: value.title, customerBody: value.customerBody,
    actorName: value.actorName as string | null, createdAt: value.createdAt, noticeId: value.noticeId, requestedAt: value.requestedAt as string | null,
    emailEnabled: value.emailEnabled, smsQueued: value.smsQueued, shipmentCount: value.shipmentCount, orderCount: value.orderCount,
    excludedCount: value.excludedCount, targets,
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

/** 미리보기의 대상 중 운영자가 뺀 배송 건을 뺀 나머지. 확정 버튼의 건수와 서버에 보내는 제외 목록이 같은 계산을 쓴다. */
export function preorderScheduleSelection(preview: Pick<PreorderSchedulePreview, 'targets'>, excluded: ReadonlySet<string>) {
  const included = preview.targets.filter((target) => !excluded.has(target.shipmentId));
  return {
    included,
    excludedShipmentIds: preview.targets.filter((target) => excluded.has(target.shipmentId)).map((target) => target.shipmentId).sort(),
    shipments: included.length,
    orders: new Set(included.map((target) => target.orderId)).size,
  };
}

/** 고객 안내에 붙는 날짜 줄(DB 문구와 같은 규칙) — 미리보기에서 고객이 받을 문장을 보인다. */
export function preorderScheduleDateLine(fromDates: readonly string[], toDates: readonly string[]): string {
  const from = [...new Set(fromDates)].sort();
  const to = [...new Set(toDates)].sort();
  if (from.length === 1 && to.length === 1) return `발송 예정일: ${from[0]} → ${to[0]}`;
  return `변경된 발송 예정일: ${to[0]}${to.length > 1 ? ` ~ ${to[to.length - 1]}` : ''}`;
}
