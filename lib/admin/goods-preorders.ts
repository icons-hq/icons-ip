import { isUuid } from '@/lib/uuid';
import { isGoodsShipDate } from '@/lib/goods-preorders';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';
import { kstInputLabel, kstInputRangeLabel, type GoodsReadback } from './goods-sale-period';

/** 예약 조건 상태. 2026-11-19부터 임시저장(초안)은 없다 — 저장하면 적용(active)이고, 접수를 중지하면 stopped다. */
export type GoodsPreorderState = 'active' | 'stopped';
export interface GoodsPreorderInput {
  state: GoodsPreorderState;
  capacityQty: number | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedShipDate: string | null;
  /** 선택 메모. 예전 '승인 근거' 칸이고 지금은 일정 일괄 변경이 변경 사유를 붙일 때만 채워진다. 화면에서 입력받지 않는다. */
  approvalReference: string | null;
}
export interface AdminGoodsPreorder extends GoodsPreorderInput {
  id: string; goodId: string; variantId: string; revision: number; selected: boolean;
  remainingQty: number | null; reservedQty: number; allocatedQty: number;
  createdAt: string; activatedAt: string | null; stoppedAt: string | null;
}
export interface AdminPreorderReservation {
  orderItemId: string; orderId: string; policyId: string; variantId: string; variantName: string | null;
  qty: number; physicalStockQty: number; state: 'reserved' | 'allocated' | 'released' | 'returned';
  orderStatus: 'pending' | 'paid' | 'confirmed' | 'shipping' | 'delivered' | 'done' | 'canceled';
  expectedShipDate: string; createdAt: string; allocatedAt: string | null; allocationReference: string | null;
  releasedAt: string | null; releaseReason: string | null;
  /** 출고 보류(테스트 결제·결제사 취소)로 실재고 할당이 막힌 주문. 선택할 수 없다(옛 응답에는 없다). */
  fulfillmentHold?: boolean;
}
export interface AdminPreorderReservationPage { total: number; items: AdminPreorderReservation[]; hasMore: boolean }
/** 예약 주문 목록 한 페이지 행 수 — 조회 RPC의 `p_limit`(상한 100)과 화면 페이지 이동이 같은 값을 쓴다. */
export const ADMIN_PREORDER_RESERVATION_PAGE_SIZE = 100;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647;
}
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function optionalInstant(value: unknown): string | null | false {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !isGoodsShipDate(value.slice(0, 10))) return false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const date = new Date(`${value}:00+09:00`);
    return Number.isFinite(date.valueOf()) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 ? date.toISOString() : false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number(value.slice(11, 13)) >= 24 || Number(value.slice(14, 16)) >= 60 || Number(value.slice(17, 19)) >= 60 || !timestamp(value)) return false;
  return value;
}
export function parseGoodsPreorderInput(value: unknown): GoodsPreorderInput | null {
  if (!object(value) || !['active', 'stopped'].includes(String(value.state))
    || Object.keys(value).some((key) => !['state', 'capacityQty', 'startsAt', 'endsAt', 'expectedShipDate', 'approvalReference'].includes(key))) return null;
  if (value.state === 'stopped') return { state: 'stopped', capacityQty: null, startsAt: null, endsAt: null, expectedShipDate: null, approvalReference: null };
  let capacityQty: number | null = null;
  if (value.capacityQty !== '' && value.capacityQty !== null && value.capacityQty !== undefined) {
    if (typeof value.capacityQty !== 'number' && (typeof value.capacityQty !== 'string' || !/^[1-9]\d*$/.test(value.capacityQty))) return null;
    if (!integer(Number(value.capacityQty), 1)) return null;
    capacityQty = Number(value.capacityQty);
  }
  const startsAt = optionalInstant(value.startsAt);
  const endsAt = optionalInstant(value.endsAt);
  if (startsAt === false || endsAt === false || (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))) return null;
  const expectedShipDate = value.expectedShipDate === '' || value.expectedShipDate == null ? null : value.expectedShipDate;
  if (expectedShipDate !== null && !isGoodsShipDate(expectedShipDate)) return null;
  if (value.approvalReference != null && typeof value.approvalReference !== 'string') return null;
  const approvalReference = typeof value.approvalReference === 'string' ? value.approvalReference.trim() || null : null;
  if (approvalReference && approvalReference.length > 2000) return null;
  if (value.state === 'active') {
    if (capacityQty === null || startsAt === null || endsAt === null || expectedShipDate === null) return null;
    const lastSaleDate = new Date(Date.parse(endsAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (expectedShipDate < lastSaleDate) return null;
  }
  return { state: value.state as GoodsPreorderState, capacityQty, startsAt, endsAt, expectedShipDate: expectedShipDate as string | null, approvalReference };
}
/*
 * 예약판매는 저장하면 적용된다(2026-11-19 사용자·MD 결정 — "그냥 MD가 등록하면 완료", "초안 저장도 그냥 없애구 다른 작성 항목이랑
 * 동일하게"). 임시저장(초안)·승인 근거·적용 권한 분리는 없다. 필요한 칸이 비거나 DB가 거절할 값이면 저장할 때 그 칸 옆에 이유를
 * 보이고 저장하지 않는다. 규칙은 DB(admin_save_goods_preorder의 invalid_preorder_policy·preorder_policy_not_configured)와 같다.
 */
export type PreorderApplyField = 'capacityQty' | 'startsAt' | 'endsAt' | 'expectedShipDate';
export const PREORDER_APPLY_FIELD_LABELS: Record<PreorderApplyField, string> = {
  capacityQty: '예약 물량', startsAt: '접수 시작', endsAt: '접수 종료', expectedShipDate: '발송 예정일',
};
const PREORDER_APPLY_FIELDS = Object.keys(PREORDER_APPLY_FIELD_LABELS) as PreorderApplyField[];
export interface PreorderApplyValues {
  /** 랜덤 판매는 옵션별 물량을 따로 보므로(preorderCapacityProblem) 공통 칸 검사에서 뺀다(undefined). */
  capacityQty?: string;
  startsAt: string;
  endsAt: string;
  expectedShipDate: string;
}
export type PreorderApplyProblems = Partial<Record<PreorderApplyField, string>>;

/*
 * 예약 물량 = 재고수량(2026-11-19 "예약상품도 그냥 재고수량 미리 입력할 수 있게"). MD는 옵션 재고수량 하나만 입력하고, 예약 물량 칸은
 * 기본으로 그 값을 따라간다(재고수량을 바꾸면 같이 바뀐다). 직접 고치면 그 값을 쓰고, 재고수량과 다르면 경고만 하고 막지 않는다.
 * DB 장부는 그대로다 — 예약이 선택된 옵션은 예약 물량으로만 팔리고(resolve_goods_variant_supply) 주문이 재고를 깎지 않으며,
 * 입고 확인(admin_allocate_goods_preorders)이 선택 합계 ≤ 실재고일 때 그만큼 재고를 차감한다. 그래서 미리 넣은 재고로 바로 할당한다.
 */
/** 예약 물량 기본값: 그 옵션의 재고수량(1 이상일 때). 0·미입력이면 빈 값이라 직접 입력한다. */
export function preorderCapacityFromStock(stockQty: number | null | undefined): string {
  return typeof stockQty === 'number' && Number.isSafeInteger(stockQty) && stockQty > 0 ? String(stockQty) : '';
}
/** 예약 물량이 재고수량과 다를 때의 안내(막지 않는다). 같거나 물량이 형식에 맞지 않으면 null. */
export function preorderCapacityStockNote(capacity: string, stockQty: number | null | undefined): string | null {
  const qty = capacity.trim();
  if (!/^[1-9]\d*$/.test(qty)) return null;
  const stock = typeof stockQty === 'number' && Number.isSafeInteger(stockQty) && stockQty > 0 ? stockQty : 0;
  if (Number(qty) === stock) return null;
  return stock === 0
    ? '재고수량이 0입니다. 물건이 들어오면 재고 조정으로 들어온 수량을 더한 뒤, 아래 예약 주문 목록에서 입고 확인을 합니다.'
    : `재고수량 ${stock.toLocaleString('ko-KR')}개와 다릅니다. 입고 확인은 재고수량 안에서만 할 수 있어, 실제로 들어온 수량과 다르면 재고 조정으로 재고수량을 맞춘 뒤 입고 확인을 합니다.`;
}

/** 예약 물량 한 칸의 저장 전 확인. 문제가 없으면 null. */
export function preorderCapacityProblem(value: string): string | null {
  const qty = value.trim();
  if (!qty) return '예약 물량을 입력해주세요.';
  return /^[1-9]\d*$/.test(qty) && integer(Number(qty), 1) ? null : '예약 물량은 1 이상의 정수로 입력해주세요.';
}

/** 예약판매 저장 전 칸별 확인. 비었거나 DB가 거절할 값이면 칸 이름을 키로 이유를 돌려준다. 빈 객체면 저장(적용)할 수 있다. */
export function preorderApplyProblems(values: PreorderApplyValues, now = Date.now()): PreorderApplyProblems {
  const problems: PreorderApplyProblems = {};
  if (values.capacityQty !== undefined) {
    const capacity = preorderCapacityProblem(values.capacityQty);
    if (capacity) problems.capacityQty = capacity;
  }
  const starts = optionalInstant(values.startsAt), ends = optionalInstant(values.endsAt);
  if (!values.startsAt) problems.startsAt = '접수 시작 일시를 입력해주세요.';
  else if (!starts) problems.startsAt = '접수 시작 일시를 다시 입력해주세요.';
  if (!values.endsAt) problems.endsAt = '접수 종료 일시를 입력해주세요.';
  else if (!ends) problems.endsAt = '접수 종료 일시를 다시 입력해주세요.';
  else if (starts && Date.parse(ends) <= Date.parse(starts)) problems.endsAt = '접수 종료는 접수 시작보다 뒤여야 합니다.';
  else if (Date.parse(ends) <= now) problems.endsAt = '접수 종료는 지금보다 뒤여야 합니다.';
  if (!values.expectedShipDate) problems.expectedShipDate = '발송 예정일을 입력해주세요.';
  else if (!isGoodsShipDate(values.expectedShipDate)) problems.expectedShipDate = '발송 예정일을 다시 입력해주세요.';
  else if (ends && values.expectedShipDate < new Date(Date.parse(ends) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)) {
    problems.expectedShipDate = '발송 예정일은 접수 종료일과 같거나 뒤여야 합니다.';
  }
  return problems;
}

/** 문제가 있는 칸 이름을 화면 순서대로 잇는다(예: '예약 물량·접수 종료'). 저장 오류 요약에 쓴다. */
export function preorderApplyProblemLabels(problems: PreorderApplyProblems): string {
  return PREORDER_APPLY_FIELDS.filter((field) => problems[field]).map((field) => PREORDER_APPLY_FIELD_LABELS[field]).join('·');
}

/*
 * 예약판매 한 번에 입력(docs/admin-screen-rules.md 규칙 6). 기본은 '모든 옵션 같은 일정'이다 — 접수 시작·종료·발송 예정일을 한 번 넣고
 * 예약 물량만 옵션별로 정한다. 옵션마다 일정을 다르게 넣는 방식은 필요할 때만 펼친다(`perOption`).
 * 등록 화면(상품과 함께 저장)과 저장된 상품의 예약판매 패널(별도 저장)이 같은 입력 모양을 쓰고, 저장할 때 옵션별 조건으로 펼친다.
 */
export interface PreorderPlanOption {
  /** 예약하지 않는 옵션(표에서 체크를 끔). */
  excluded?: boolean;
  /** 직접 고친 예약 물량. 없으면 그 옵션의 재고수량을 따라간다(11/19 '예약 물량 = 재고수량'). */
  capacityQty?: string;
  /** '옵션마다 일정을 다르게'에서 고친 이 옵션의 일정. 없으면 공통 일정을 쓴다. */
  startsAt?: string;
  endsAt?: string;
  expectedShipDate?: string;
}
export interface PreorderPlan {
  /** 옵션마다 일정을 다르게 넣는 중. */
  perOption: boolean;
  startsAt: string;
  endsAt: string;
  expectedShipDate: string;
  /** 옵션 키(등록 화면은 옵션 행 키, 저장된 상품은 옵션 id)별 입력. 없는 키는 '예약함 · 재고수량을 따라감 · 공통 일정'이다. */
  options: Record<string, PreorderPlanOption>;
}
/** 예약할 수 있는 옵션 한 줄. 사용 중이고 이미 접수 중인 예약 조건이 없는 옵션만 넘긴다. */
export interface PreorderPlanTarget {
  key: string; name: string; stockQty: number | null | undefined;
  /** 이전 회차에 받아 아직 입고 확인하지 않은 예약 수량(저장된 상품만). 재고수량에 들어 있는 수량이라 새 예약 물량의 기본값에서 뺀다. */
  pendingQty?: number;
}
/**
 * 새 예약으로 더 받을 수 있는 수량: 재고수량에서 이전 회차의 입고 확인 전 예약을 뺀 값(0 아래로는 내려가지 않는다).
 * 예약 주문은 입고 확인 전까지 재고수량을 줄이지 않는다. 그래서 이전 회차 예약이 남은 옵션에 재고수량 그대로 새 예약을 받으면 그만큼 더 팔린다.
 */
export function preorderSellableStock(target: Pick<PreorderPlanTarget, 'stockQty' | 'pendingQty'> | undefined): number | null | undefined {
  if (!target || typeof target.stockQty !== 'number' || !Number.isSafeInteger(target.stockQty)) return target?.stockQty;
  return Math.max(0, target.stockQty - Math.max(0, target.pendingQty ?? 0));
}
/** 옵션별로 펼친 예약 조건 하나. */
export interface PreorderPlanEntry {
  key: string; name: string; capacityQty: string; capacityFromStock: boolean; startsAt: string; endsAt: string; expectedShipDate: string;
}
export function emptyPreorderPlan(): PreorderPlan {
  return { perOption: false, startsAt: '', endsAt: '', expectedShipDate: '', options: {} };
}
/** `all`: 랜덤 판매 — 모든 옵션이 같은 일정으로 예약해야 하므로 빼둔 옵션·옵션별 일정을 무시한다. */
export interface PreorderPlanScope { all?: boolean }

/** 화면 입력을 옵션별 예약 조건으로 펼친다. 체크를 끈 옵션은 빠지고, 물량을 고치지 않은 옵션은 지금 재고수량을 쓴다. */
export function expandPreorderPlan(plan: PreorderPlan, targets: readonly PreorderPlanTarget[], { all = false }: PreorderPlanScope = {}): PreorderPlanEntry[] {
  const perOption = plan.perOption && !all;
  return targets.flatMap((target) => {
    const option = plan.options[target.key] ?? {};
    if (option.excluded && !all) return [];
    const capacityFromStock = option.capacityQty === undefined;
    return [{ key: target.key, name: target.name, capacityFromStock,
      capacityQty: capacityFromStock ? preorderCapacityFromStock(preorderSellableStock(target)) : option.capacityQty!,
      startsAt: (perOption ? option.startsAt : undefined) ?? plan.startsAt, endsAt: (perOption ? option.endsAt : undefined) ?? plan.endsAt,
      expectedShipDate: (perOption ? option.expectedShipDate : undefined) ?? plan.expectedShipDate }];
  });
}
/** 다시 입력해야 하는 값이 있는가(일정·직접 고친 물량·옵션별 일정·빼둔 옵션). 판매 시기를 바꿔 입력을 버리기 전에 묻는 기준이다(규칙 7). */
export function preorderPlanHasInput(plan: PreorderPlan): boolean {
  return Boolean(plan.startsAt || plan.endsAt || plan.expectedShipDate
    || Object.values(plan.options).some((option) => option.excluded || option.capacityQty !== undefined || option.startsAt !== undefined
      || option.endsAt !== undefined || option.expectedShipDate !== undefined));
}
/** 예약하는 옵션 가운데 직접 넣은 물량이 `qty`(null은 재고수량)와 다른 옵션 수. 한꺼번에 채우기 전에 바뀌는 수를 알린다(규칙 7). */
export function preorderPlanManualCapacities(plan: PreorderPlan, targets: readonly PreorderPlanTarget[], qty: string | null, scope: PreorderPlanScope = {}): number {
  return expandPreorderPlan(plan, targets, scope).filter((entry) => !entry.capacityFromStock && entry.capacityQty.trim() !== ''
    && entry.capacityQty.trim() !== (qty ?? preorderCapacityFromStock(preorderSellableStock(targets.find((target) => target.key === entry.key))))).length;
}
/** 예약하는 모든 옵션의 물량을 한 번에 채운다. `qty`가 null이면 재고수량을 따라가게 되돌린다([재고수량과 같게]). */
export function fillPreorderPlanCapacity(plan: PreorderPlan, targets: readonly PreorderPlanTarget[], qty: string | null, { all = false }: PreorderPlanScope = {}): PreorderPlan {
  const options = { ...plan.options };
  for (const target of targets) {
    const { capacityQty, ...rest } = options[target.key] ?? {};
    void capacityQty;
    if (rest.excluded && !all) continue;
    if (qty === null) { if (Object.keys(rest).length) options[target.key] = rest; else delete options[target.key]; } else options[target.key] = { ...rest, capacityQty: qty };
  }
  return { ...plan, options };
}
/** 옵션마다 넣은 일정이 공통 일정과 다른 옵션 수. '옵션마다 일정을 다르게'를 끄기 전에 사라지는 수를 알린다(규칙 7). */
export function preorderPlanOwnSchedules(plan: PreorderPlan, targets: readonly PreorderPlanTarget[]): number {
  return targets.filter((target) => {
    const option = plan.options[target.key];
    return Boolean(option && !option.excluded && ((option.startsAt ?? plan.startsAt) !== plan.startsAt || (option.endsAt ?? plan.endsAt) !== plan.endsAt
      || (option.expectedShipDate ?? plan.expectedShipDate) !== plan.expectedShipDate));
  }).length;
}
/** '옵션마다 일정을 다르게'를 켜고 끈다. 끄면 옵션별 일정을 지워 모든 옵션이 공통 일정을 쓴다(물량·체크는 그대로). */
export function setPreorderPlanPerOption(plan: PreorderPlan, perOption: boolean): PreorderPlan {
  if (perOption) return { ...plan, perOption: true };
  const options: Record<string, PreorderPlanOption> = {};
  for (const [key, option] of Object.entries(plan.options)) {
    const rest: PreorderPlanOption = { ...(option.excluded ? { excluded: true } : {}), ...(option.capacityQty === undefined ? {} : { capacityQty: option.capacityQty }) };
    if (Object.keys(rest).length) options[key] = rest;
  }
  return { ...plan, perOption: false, options };
}

/** 저장 전 확인. `common`은 공통 일정 칸, `options`는 옵션 키별 칸, `none`은 예약할 옵션이 하나도 없음. */
export interface PreorderPlanProblems { common: PreorderApplyProblems; options: Record<string, PreorderApplyProblems>; none: boolean }
export function preorderPlanProblems(plan: PreorderPlan, targets: readonly PreorderPlanTarget[], { all = false, now = Date.now() }: PreorderPlanScope & { now?: number } = {}): PreorderPlanProblems {
  const entries = expandPreorderPlan(plan, targets, { all });
  const perOption = plan.perOption && !all;
  const options: Record<string, PreorderApplyProblems> = {};
  for (const entry of entries) {
    const capacity = preorderCapacityProblem(entry.capacityQty);
    const found: PreorderApplyProblems = perOption ? preorderApplyProblems(entry, now) : capacity ? { capacityQty: capacity } : {};
    if (Object.keys(found).length) options[entry.key] = found;
  }
  return { common: perOption ? {} : preorderApplyProblems({ startsAt: plan.startsAt, endsAt: plan.endsAt, expectedShipDate: plan.expectedShipDate }, now), options, none: entries.length === 0 };
}
/** `table`: 옵션 표를 보이는 화면(옵션이 둘 이상)이면 옵션 칸 이름 앞에 '옵션별'을 붙인다. 문제가 없으면 null. */
export function preorderPlanProblemMessage(problems: PreorderPlanProblems, { table = true }: { table?: boolean } = {}): string | null {
  if (problems.none) return '예약할 옵션을 하나 이상 체크해주세요.';
  const optionFields = PREORDER_APPLY_FIELDS.filter((field) => Object.values(problems.options).some((found) => found[field]))
    .map((field) => `${table ? '옵션별 ' : ''}${PREORDER_APPLY_FIELD_LABELS[field]}`);
  /* 요약은 화면 순서(공통 일정 → 옵션 표)로 잇는다. 옵션이 하나뿐인 화면은 예약 물량이 일정 앞 칸이다. */
  const common = preorderApplyProblemLabels(problems.common);
  const labels = (table ? [common, ...optionFields] : [...optionFields, common]).filter(Boolean).join('·');
  return labels ? `${labels} 칸을 확인해주세요.` : null;
}
/** 막힌 첫 칸의 `data-preorder-field` 값. 옵션 표의 칸은 `칸:옵션 키`, 옵션이 하나뿐인 화면의 물량은 `capacityQty`다. */
export function firstPreorderPlanProblemField(problems: PreorderPlanProblems, targets: readonly PreorderPlanTarget[], { table = true }: { table?: boolean } = {}): string | undefined {
  const optionField = () => {
    for (const target of targets) {
      const field = PREORDER_APPLY_FIELDS.find((name) => problems.options[target.key]?.[name]);
      if (field) return table ? `${field === 'capacityQty' ? 'capacity' : field}:${target.key}` : field;
    }
    return undefined;
  };
  const common = (['startsAt', 'endsAt', 'expectedShipDate'] as const).find((field) => problems.common[field]);
  return table ? common ?? optionField() : optionField() ?? common;
}

/**
 * 예약 입력 되읽기('글보다 화면' 3): "12월 1일 10:00부터 7일 23:59까지 주문받고 12월 20일에 보냅니다. 옵션 12개 · 예약 물량 합계 1,200개."
 * 덜 채워졌으면 채워진 만큼만 읽고, 순서가 틀리면(종료가 시작보다 앞·발송 예정일이 접수 종료일보다 앞·접수 종료가 지남) 그 자리에서 알린다.
 */
export function preorderPlanReadback(plan: PreorderPlan, targets: readonly PreorderPlanTarget[], { all = false, now = Date.now(), table = true }: PreorderPlanScope & { now?: number; table?: boolean } = {}): GoodsReadback | null {
  const entries = expandPreorderPlan(plan, targets, { all });
  const valid = entries.filter((entry) => !preorderCapacityProblem(entry.capacityQty));
  const total = valid.reduce((sum, entry) => sum + Number(entry.capacityQty), 0).toLocaleString('ko-KR');
  const blank = entries.length - valid.length;
  const scope = !entries.length ? '' : !table ? (blank ? '' : `예약 물량 ${total}개.`)
    : blank ? `옵션 ${entries.length}개 중 ${blank}개는 예약 물량이 비어 있습니다.` : `옵션 ${entries.length}개 · 예약 물량 합계 ${total}개.`;
  if (plan.perOption && !all) return scope ? { text: `옵션마다 다른 일정으로 주문받습니다. ${scope}`, problem: false } : null;
  const range = kstInputRangeLabel(plan.startsAt, plan.endsAt, now);
  if (range?.reversed) return { text: '접수 종료가 접수 시작보다 앞입니다. 날짜를 다시 확인해주세요.', problem: true };
  const ends = optionalInstant(plan.endsAt);
  if (ends && Date.parse(ends) <= now) return { text: '접수 종료가 이미 지났습니다. 날짜를 다시 확인해주세요.', problem: true };
  const ship = isGoodsShipDate(plan.expectedShipDate) ? plan.expectedShipDate : '';
  if (ship && ends && ship < new Date(Date.parse(ends) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)) {
    return { text: '발송 예정일이 접수 종료일보다 앞입니다. 날짜를 다시 확인해주세요.', problem: true };
  }
  const shipLabel = ship ? kstInputLabel(ship, now) : null;
  const schedule = range && shipLabel ? `${range.text} 주문받고 ${shipLabel}에 보냅니다.` : range ? `${range.text} 주문받습니다.` : shipLabel ? `${shipLabel}에 보냅니다.` : '';
  const text = [schedule, scope].filter(Boolean).join(' ');
  return text ? { text, problem: false } : null;
}

/**
 * 저장된 상품에서 새로 예약할 수 있는 옵션과 그대로 두는 옵션. 이미 접수 중·접수 예정(또는 접수 기간이 끝났지만 아직 중지하지 않은)
 * 예약 조건이 있는 옵션은 표에서 뺀다(규칙 2) — 그 조건을 중지하고 새로 만들면 남은 예약 물량이 처음부터 다시 계산돼 더 팔 수 있기 때문이다.
 */
export function preorderEditorTargets<V extends { id: string; archivedAt: string | null }>(variants: readonly V[], policies: readonly Pick<AdminGoodsPreorder, 'variantId' | 'state'>[]):
  { available: V[]; busy: V[] } {
  const active = variants.filter((variant) => !variant.archivedAt);
  const taken = new Set(policies.filter((policy) => policy.state === 'active').map((policy) => policy.variantId));
  return { available: active.filter((variant) => !taken.has(variant.id)), busy: active.filter((variant) => taken.has(variant.id)) };
}

/**
 * 일반(옵션 선택 판매) 상품의 일괄 예약 저장(`admin_save_goods_preorders_bulk`). 옵션마다 물량·일정을 실어 한 트랜잭션으로 저장한다.
 * 이미 접수 중인 조건이 있는 옵션은 DB가 건너뛰고 알려 준다(받은 예약 수량을 잃지 않게 그대로 둔다).
 */
export interface GoodsPreorderBulkOption { variantId: string; values: Pick<GoodsPreorderInput, 'capacityQty' | 'startsAt' | 'endsAt' | 'expectedShipDate'> }
export function parseGoodsPreorderBulkRequest(optionsValue: unknown): GoodsPreorderBulkOption[] | null {
  if (!Array.isArray(optionsValue) || !optionsValue.length || optionsValue.length > 100) return null;
  const options: GoodsPreorderBulkOption[] = [];
  for (const row of optionsValue) {
    if (!object(row) || !isUuid(row.variantId) || options.some((option) => option.variantId === row.variantId)
      || Object.keys(row).some((key) => !['variantId', 'capacityQty', 'startsAt', 'endsAt', 'expectedShipDate'].includes(key))) return null;
    const parsed = parseGoodsPreorderInput({ state: 'active', capacityQty: row.capacityQty, startsAt: row.startsAt, endsAt: row.endsAt, expectedShipDate: row.expectedShipDate });
    if (!parsed) return null;
    options.push({ variantId: row.variantId, values: { capacityQty: parsed.capacityQty, startsAt: parsed.startsAt, endsAt: parsed.endsAt, expectedShipDate: parsed.expectedShipDate } });
  }
  return options;
}
/** 옵션 이름을 잇는다. 많으면 앞의 셋만 들고 나머지는 수로 말한다('빨강·파랑·초록 외 27개'). */
export function preorderOptionNames(names: readonly string[], limit = 3): string {
  return names.length > limit ? `${names.slice(0, limit).join('·')} 외 ${(names.length - limit).toLocaleString('ko-KR')}개` : names.join('·');
}
/** 일괄 저장 결과 안내. 건너뛴 옵션은 이름(`skippedNames` — preorderOptionNames로 이은 글)을 들어 그대로 두었다고 알린다. */
export function preorderBulkSavedMessage(savedCount: number, skippedNames: string): string {
  const skipped = skippedNames ? `${skippedNames} 옵션은 이미 예약판매 중이라 그대로 두었습니다. 바꾸려면 그 예약 조건에서 [새 예약 접수 중지]를 누른 뒤 다시 저장해주세요.` : '';
  if (!savedCount) return skipped || '저장한 예약 조건이 없습니다.';
  return [`${savedCount > 1 ? `옵션 ${savedCount.toLocaleString('ko-KR')}개에 ` : ''}예약판매를 저장했습니다. 접수 기간 동안 예약 물량으로 판매합니다.`, skipped].filter(Boolean).join(' ');
}

export function parseAdminGoodsPreorders(value: unknown): AdminGoodsPreorder[] | null {
  if (!Array.isArray(value)) return null;
  const result: AdminGoodsPreorder[] = [];
  for (const row of value) {
    if (!object(row) || !isUuid(row.id) || !isUuid(row.variantId) || typeof row.goodId !== 'string' || !row.goodId
      || !['active', 'stopped'].includes(String(row.state)) || !integer(row.revision, 1) || typeof row.selected !== 'boolean'
      || !integer(row.reservedQty) || !integer(row.allocatedQty) || !timestamp(row.createdAt)
      || (row.activatedAt !== null && !timestamp(row.activatedAt)) || (row.stoppedAt !== null && !timestamp(row.stoppedAt))) return null;
    const input = parseGoodsPreorderInput({ state: 'active', capacityQty: row.capacityQty,
      startsAt: row.startsAt, endsAt: row.endsAt, expectedShipDate: row.expectedShipDate, approvalReference: row.approvalReference });
    if (!input || (input.capacityQty === null ? row.remainingQty !== null : !integer(row.remainingQty)
      || row.remainingQty !== input.capacityQty - row.reservedQty - row.allocatedQty)
      || row.activatedAt === null || (row.state === 'stopped' && row.stoppedAt === null)) return null;
    result.push({ ...input, state: row.state as GoodsPreorderState, id: row.id, variantId: row.variantId, goodId: row.goodId,
      revision: row.revision, selected: row.selected, remainingQty: row.remainingQty as number | null,
      reservedQty: row.reservedQty, allocatedQty: row.allocatedQty, createdAt: row.createdAt,
      activatedAt: row.activatedAt as string | null, stoppedAt: row.stoppedAt as string | null });
  }
  return result;
}
export function parseAdminPreorderReservations(value: unknown): AdminPreorderReservationPage | null {
  if (!object(value) || !integer(value.total) || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean') return null;
  const items: AdminPreorderReservation[] = [];
  for (const row of value.items) {
    if (!object(row) || !isUuid(row.orderItemId) || !isUuid(row.orderId) || !isUuid(row.policyId) || !isUuid(row.variantId)
      || !integer(row.qty, 1) || !integer(row.physicalStockQty) || !timestamp(row.createdAt) || !isGoodsShipDate(row.expectedShipDate)
      || (row.variantName !== null && typeof row.variantName !== 'string')
      || !['reserved', 'allocated', 'released', 'returned'].includes(String(row.state))
      || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(row.orderStatus))
      || (row.allocatedAt !== null && !timestamp(row.allocatedAt)) || (row.releasedAt !== null && !timestamp(row.releasedAt))
      || (row.allocationReference !== null && typeof row.allocationReference !== 'string')
      || (row.releaseReason !== null && typeof row.releaseReason !== 'string')
      || (row.fulfillmentHold !== undefined && typeof row.fulfillmentHold !== 'boolean')
      || items.some((item) => item.orderItemId === row.orderItemId)) return null;
    items.push(row as unknown as AdminPreorderReservation);
  }
  return items.length <= value.total ? { total: value.total, items, hasMore: value.hasMore } : null;
}
export function preparePreorderAllocation(rows: readonly Pick<AdminPreorderReservation, 'orderItemId' | 'variantId' | 'physicalStockQty'>[], idsValue: unknown):
  { orderItemIds: string[]; expectedStock: Record<string, number> } | null {
  if (!Array.isArray(idsValue) || !idsValue.length || idsValue.length > 100 || !idsValue.every(isUuid)
    || new Set(idsValue).size !== idsValue.length) return null;
  const expectedStock: Record<string, number> = {};
  for (const id of idsValue) {
    const row = rows.find((item) => item.orderItemId === id);
    if (!row || !isUuid(row.variantId) || !integer(row.physicalStockQty)
      || (Object.hasOwn(expectedStock, row.variantId) && expectedStock[row.variantId] !== row.physicalStockQty)) return null;
    expectedStock[row.variantId] = row.physicalStockQty;
  }
  return { orderItemIds: idsValue, expectedStock };
}

/**
 * 옵션별 미할당 예약 합계(남은 옵션만). 일반 재고 전환(`admin_use_stock_supply`)은 지금 선택된 정책만이 아니라 그 옵션의
 * 모든 예약 정책 — 2회차부터는 이전 회차의 중지된 정책까지 — 에 남은 미할당(reserved) 예약을 보고 `preorder_allocations_pending`으로
 * 거절한다. 예약 조건 목록(`admin_list_goods_preorders`)은 상품의 모든 정책을 정책별 미할당 수량과 함께 주므로, 화면도 이 합계로
 * 전환 버튼을 막는다.
 */
export function pendingPreorderReservationsByVariant(policies: readonly Pick<AdminGoodsPreorder, 'variantId' | 'reservedQty'>[]): Map<string, number> {
  const pending = new Map<string, number>();
  for (const policy of policies) {
    if (policy.reservedQty > 0) pending.set(policy.variantId, (pending.get(policy.variantId) ?? 0) + policy.reservedQty);
  }
  return pending;
}

/**
 * 랜덤 판매 상품의 일괄 예약 저장(`admin_save_random_goods_preorders`). 모든 판매 중 옵션이 같은 접수 기간·발송 예정일을 쓰고
 * 예약 물량만 옵션별이다. 중지·일반 재고 전환도 모든 옵션을 한 트랜잭션으로 바꾼다(옵션 하나만 바꾸면 커밋에서 거절된다).
 */
export type RandomPreorderBulkState = 'active' | 'stopped' | 'stock';
export interface RandomPreorderOptionInput {
  variantId: string;
  /** 지금 선택된 정책(중지·일반 재고 전환). 적용(새로 저장)은 null. */
  policyId: string | null;
  expectedRevision: number | null;
  /** 적용만. 모든 옵션에 필요하다. */
  capacityQty?: number | null;
}
export interface RandomPreorderRequest {
  state: RandomPreorderBulkState;
  values: Pick<GoodsPreorderInput, 'startsAt' | 'endsAt' | 'expectedShipDate' | 'approvalReference'> | null;
  options: RandomPreorderOptionInput[];
}
function capacityValue(value: unknown): number | null | false {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'string' ? !/^[1-9]\d*$/.test(value) : typeof value !== 'number') return false;
  const number = Number(value);
  return integer(number, 1) ? number : false;
}
export function parseRandomPreorderRequest(stateValue: unknown, valuesValue: unknown, optionsValue: unknown): RandomPreorderRequest | null {
  if (!['active', 'stopped', 'stock'].includes(String(stateValue)) || !Array.isArray(optionsValue)
    || !optionsValue.length || optionsValue.length > 100) return null;
  const state = stateValue as RandomPreorderBulkState;
  const schedule = state === 'active';
  let values: RandomPreorderRequest['values'] = null;
  if (schedule) {
    if (!object(valuesValue)) return null;
    /* 옵션별 물량은 따로 검사하므로 공통 값 검사에는 자리 값 1을 넣는다. */
    const parsed = parseGoodsPreorderInput({ state, capacityQty: 1, startsAt: valuesValue.startsAt,
      endsAt: valuesValue.endsAt, expectedShipDate: valuesValue.expectedShipDate, approvalReference: valuesValue.approvalReference });
    if (!parsed) return null;
    values = { startsAt: parsed.startsAt, endsAt: parsed.endsAt, expectedShipDate: parsed.expectedShipDate, approvalReference: parsed.approvalReference };
  } else if (valuesValue != null) return null;
  const options: RandomPreorderOptionInput[] = [];
  for (const row of optionsValue) {
    if (!object(row) || !isUuid(row.variantId) || options.some((option) => option.variantId === row.variantId)
      || (row.policyId !== null && !isUuid(row.policyId)) || (row.expectedRevision !== null && !integer(row.expectedRevision, 1))
      || (row.policyId === null) !== (row.expectedRevision === null)
      || Object.keys(row).some((key) => !['variantId', 'policyId', 'expectedRevision', ...(schedule ? ['capacityQty'] : [])].includes(key))) return null;
    const base = { variantId: row.variantId, policyId: row.policyId as string | null, expectedRevision: row.expectedRevision as number | null };
    if (!schedule) {
      if (base.policyId === null) return null;
      options.push(base);
      continue;
    }
    const capacityQty = capacityValue(row.capacityQty);
    if (capacityQty === false || capacityQty === null || base.policyId !== null) return null;
    options.push({ ...base, capacityQty });
  }
  return { state, values, options };
}

export function preorderMutationError(message: string): string {
  /* D5② 랜덤 판매 상품은 모든 옵션이 같은 일정으로 예약해야 한다 — 커밋 시점 지연 제약이 random_option_*로 거절한다. */
  if (RANDOM_OPTION_PROBLEMS.some((code) => message.includes(code))) return goodsOptionSaleModeErrorMessage(message);
  const errors: Record<string, string> = {
    preorder_admin_required: '접수 중인 예약 조건 교체는 계정 주매니저·통합 매니저만 할 수 있습니다.',
    preorder_policy_changed: '다른 화면에서 예약 조건이 먼저 바뀌었습니다. [저장된 예약 조건 새로고침]을 누른 뒤 다시 처리해주세요.',
    preorder_policy_not_configured: '예약 물량·접수 기간(종료는 지금 이후)·발송 예정일(접수 종료일과 같거나 뒤)을 모두 입력해야 저장할 수 있습니다.',
    invalid_preorder_policy: '예약 물량은 1 이상의 정수, 접수 종료는 접수 시작보다 뒤여야 합니다. 화면을 새로고침한 뒤 다시 입력해 저장해주세요.',
    preorder_policy_already_active: '이 옵션에 이미 적용 중인 예약이 있습니다. 기존 예약 조건의 [새 예약 접수 중지]를 누른 뒤 새로 저장해주세요.',
    preorder_policy_immutable: '저장한 예약 조건은 바꿀 수 없습니다. [새 예약 접수 중지]를 누른 뒤 새 예약 조건을 저장해주세요.',
    preorder_runtime_not_ready: '예약판매 기능을 준비 중입니다. 아직 저장할 수 없습니다.',
    /* 판매 시기 선택이 화면에서 먼저 막는다. 다른 창에서 그사이 판매기간·주문 후 제작을 저장했을 때만 여기까지 온다. */
    goods_sale_period_preorder_conflict: "이 상품에 판매기간이 저장돼 있어 예약판매를 저장할 수 없습니다. 판매 시기에서 '예약판매'를 고르고 상품을 먼저 저장한 뒤 예약판매를 다시 저장해주세요.",
    production_preorder_conflict: "주문 후 제작을 쓰는 상품은 예약판매를 함께 쓸 수 없습니다. '주문 후 제작'의 체크를 끄고 저장한 뒤 예약판매를 다시 저장해주세요.",
    goods_variant_inactive: '사용 중지한 옵션에는 예약판매를 저장할 수 없습니다. [저장된 예약 조건 새로고침]을 누른 뒤 사용 중인 옵션만 다시 저장해주세요.',
    goods_variant_not_found: '그사이 옵션이 바뀌었습니다. 화면을 새로고침한 뒤 예약할 옵션을 다시 확인하고 저장해주세요.',
    invalid_preorder_bulk: '입력한 내용을 저장하지 못했습니다. 화면을 새로고침한 뒤 접수 기간·발송 예정일·옵션별 예약 물량을 다시 확인하고 저장해주세요.',
    preorder_allocations_pending: '입고 확인 전인 예약 주문이 남아 있어 일반 재고 판매로 전환할 수 없습니다. 예약 주문 목록에서 입고 확인을 하거나 주문을 취소한 뒤 다시 전환해주세요.',
    preorder_physical_stock_changed: '그사이 옵션 재고수량이 바뀌었습니다. [예약 주문 새로고침]을 누른 뒤 재고수량을 확인하고 다시 입고 확인해주세요.',
    preorder_physical_stock_shortfall: '선택한 예약 주문 수량이 옵션 재고수량보다 많습니다. 선택을 줄이거나 재고 조정으로 재고수량을 맞춘 뒤 다시 입고 확인해주세요.',
    preorder_payment_required: '입금·결제가 확인된 예약 주문만 입고 확인할 수 있습니다. 결제 대기 주문은 빼고 다시 눌러주세요.',
    preorder_reservation_released: '취소된 예약 품목이 선택에 있습니다. [예약 주문 새로고침]을 누른 뒤 취소된 품목을 빼고 다시 입고 확인해주세요.',
    random_preorder_options_mismatch: '판매 중인 옵션이나 예약 상태가 바뀌었습니다. [저장된 예약 조건 새로고침]을 누른 뒤 모든 옵션을 다시 확인해주세요.',
    random_option_required: '랜덤 판매 상품에서만 모든 옵션을 한 번에 예약할 수 있습니다. 판매 방식을 확인해주세요.',
    invalid_random_preorder: '입력한 내용을 저장하지 못했습니다. 화면을 새로고침한 뒤 접수 기간·발송 예정일·옵션별 예약 물량을 다시 확인하고 저장해주세요.',
    'order cancellation in progress': '취소·반품·교환 요청이 진행 중인 주문이 선택에 있습니다. 그 요청을 먼저 처리하거나 그 주문을 빼고 다시 입고 확인해주세요.',
    'order fulfillment hold': '출고 보류 중인 주문(결제 확인 필요)이 선택에 있습니다. "출고 보류" 표시가 붙은 주문을 빼고 다시 입고 확인해주세요.',
  };
  return errors[message] ?? '예약판매 처리를 완료하지 못했습니다. [저장된 예약 조건 새로고침]으로 지금 상태를 확인한 뒤 다시 시도해주세요.';
}
