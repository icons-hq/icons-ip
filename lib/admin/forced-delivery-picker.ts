import { isCommerceNumber } from '@/lib/commerce-number';
import { isUuid } from '@/lib/uuid';

/*
 * 강제 배송완료의 '주문 고르기'(화면 규칙 1). 주문번호 20자리를 손으로 맞춰 적게 하지 않고 공용 선택창에서 찾아 고른다.
 * 조회는 주문 통합검색과 같은 DB 조회(admin_search_orders_console)를 쓴다. 그 조회는 주문 상태를 하나만 받으므로,
 * 강제 배송완료를 할 수 있는 두 상태(발주확인·배송중)를 선택창의 조건으로 나눠 보인다. 그 밖의 상태는 목록에 넣지 않는다(화면 규칙 2).
 * 취소 요청이 진행 중인 주문처럼 목록에서 보이는 막는 사유는 줄에서 막고 이유를 보인다. 나머지 막는 사유(예약 입고 확인 전·주문제작·출고 보류·
 * 취소·반품·교환 이력)는 이 조회로 알 수 없어 [강제 배송완료]를 누를 때 DB 미리보기가 알려 준다.
 */
export const FORCED_DELIVERY_PICKER_STATUSES = ['confirmed', 'shipping'] as const;
export type ForcedDeliveryPickerStatus = typeof FORCED_DELIVERY_PICKER_STATUSES[number];
/** 검색 대상. 값은 주문 통합검색 조회(admin_search_orders_console)의 p_field와 같다. */
export const FORCED_DELIVERY_PICKER_FIELDS = ['order', 'nickname', 'product', 'tracking'] as const;
export type ForcedDeliveryPickerField = typeof FORCED_DELIVERY_PICKER_FIELDS[number];
/** DB 조회가 받는 검색어 길이. */
export const FORCED_DELIVERY_PICKER_QUERY_MAX = 100;
const LAST_PAGE = 10_000;

export interface ForcedDeliveryOrderRow {
  /** 화면에 보이지 않는 줄 구분용 내부 값. 보이는 번호는 orderNumber다. */
  orderId: string;
  orderNumber: string;
  buyerName: string;
  status: ForcedDeliveryPickerStatus;
  total: number;
  createdAt: string;
  /** 취소 요청이 진행 중이다. 이때 DB는 강제 배송완료를 막는다(미리보기의 claim_in_progress). */
  cancellationInProgress: boolean;
}

export interface ForcedDeliveryPickRequest {
  query: string;
  field: ForcedDeliveryPickerField;
  status: ForcedDeliveryPickerStatus;
  page: number;
}

/** 선택창이 보낸 조회 조건을 DB 조회가 받는 모양으로 맞춘다. 모르는 값은 기본(주문번호·발주확인·첫 쪽)으로 돌린다. */
export function normalizeForcedDeliveryPickRequest(input: unknown): ForcedDeliveryPickRequest {
  const { query, field, filter, page } = input && typeof input === 'object' && !Array.isArray(input)
    ? input as { query?: unknown; field?: unknown; filter?: unknown; page?: unknown } : {};
  return {
    query: typeof query === 'string' ? query.trim().slice(0, FORCED_DELIVERY_PICKER_QUERY_MAX) : '',
    field: FORCED_DELIVERY_PICKER_FIELDS.find(value => value === field) ?? 'order',
    status: FORCED_DELIVERY_PICKER_STATUSES.find(value => value === filter) ?? 'confirmed',
    page: typeof page === 'number' && Number.isSafeInteger(page) ? Math.min(Math.max(1, page), LAST_PAGE) : 1,
  };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** 취소 요청이 아직 끝나지 않은 상태. 강제 배송완료 미리보기의 claim_in_progress와 같은 세 값이다. */
const CANCELLATION_OPEN = new Set(['requested', 'processing', 'needs_review']);

/** DB 조회 결과를 선택창 줄로 읽는다. 모르는 모양이 하나라도 있으면 통째로 거절한다(일부만 보이지 않게). */
export function parseForcedDeliveryOrderRows(data: unknown): { rows: ForcedDeliveryOrderRow[]; total: number } | null {
  if (!Array.isArray(data)) return null;
  const rows: ForcedDeliveryOrderRow[] = [];
  let total = 0;
  for (const row of data) {
    if (!record(row) || !isUuid(row.id) || !isUuid(row.user_id) || typeof row.order_number !== 'string' || !isCommerceNumber(row.order_number, 'order')
      || !FORCED_DELIVERY_PICKER_STATUSES.includes(row.status as ForcedDeliveryPickerStatus)
      || typeof row.total !== 'number' || !Number.isSafeInteger(row.total) || row.total < 0
      || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
      || !(row.buyer_name === null || typeof row.buyer_name === 'string')
      || !(row.cancellation_request_status === null || row.cancellation_request_status === undefined || typeof row.cancellation_request_status === 'string')) return null;
    const count = Number(row.total_count);
    if (!Number.isSafeInteger(count) || count < 0) return null;
    total = count;
    rows.push({
      orderId: row.id, orderNumber: row.order_number,
      /* 주문 상세·미리보기와 같은 이름 규칙이다(별명이 비어 있으면 fan_ 뒤 여섯 글자). */
      buyerName: row.buyer_name?.trim() || `fan_${row.user_id.slice(0, 6)}`,
      status: row.status as ForcedDeliveryPickerStatus, total: row.total, createdAt: row.created_at,
      cancellationInProgress: typeof row.cancellation_request_status === 'string' && CANCELLATION_OPEN.has(row.cancellation_request_status),
    });
  }
  return { rows, total };
}

/** 이 줄을 고를 수 없는 이유. 고를 수 있으면 null이다. */
export function forcedDeliveryOrderBlocked(row: Pick<ForcedDeliveryOrderRow, 'cancellationInProgress'>): string | null {
  return row.cancellationInProgress ? '취소 요청이 진행 중입니다' : null;
}
