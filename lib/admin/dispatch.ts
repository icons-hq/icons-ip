/** Shipping delay remains an operational order note, independent of shipment state. */
export const ADMIN_DISPATCH_DELAY_DAYS = 3;

/** 발송지연 메모. 운영 기록이며 구매자에게 보이지 않는다. */
export interface AdminDispatchDelayNote {
  reason: string;
  /** 발송 예정일 `YYYY-MM-DD`. 모르면 `null` — 지어낸 날짜는 CS에서 약속이 된다. */
  expectedShipDate: string | null;
  updatedAt: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** DB의 order_dispatch_delays_reason_check와 같은 상한이다. */
export const ADMIN_DISPATCH_DELAY_REASON_MAX = 500;

export interface AdminDispatchDelayFormValue {
  orderId: string;
  /** 비우면 메모를 지운다 — "지연이 풀렸다"를 표현할 방법이 필요하다. */
  reason: string | null;
  expectedShipDate: string | null;
}

export type AdminDispatchDelayFormResult =
  | { ok: true; value: AdminDispatchDelayFormValue }
  | { ok: false; errors: Record<string, string> };

/**
 * 지연 메모 폼 정규화.
 *
 * 발송 예정일은 선택 입력이다. 모르는 날짜를 지어내면 CS에서 그대로 약속이 되므로,
 * 비워 두는 것이 정상 경로여야 한다. 형식이 깨진 날짜는 조용히 버리지 않고 되돌린다 —
 * 운영자가 적은 날짜가 사라지면 저장된 줄 안다.
 */
export function normalizeAdminDispatchDelayForm(formData: FormData): AdminDispatchDelayFormResult {
  const orderId = String(formData.get('orderId') ?? '').trim().toLowerCase();
  const rawReason = String(formData.get('reason') ?? '').trim();
  const rawDate = String(formData.get('expectedShipDate') ?? '').trim();
  const errors: Record<string, string> = {};

  if (!UUID_PATTERN.test(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (rawReason.length > ADMIN_DISPATCH_DELAY_REASON_MAX) {
    errors.reason = `지연 사유는 ${ADMIN_DISPATCH_DELAY_REASON_MAX}자까지 입력할 수 있습니다.`;
  }
  if (rawDate && !validCalendarDate(rawDate)) {
    errors.expectedShipDate = '발송 예정일을 YYYY-MM-DD 형식으로 입력해주세요.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      orderId,
      reason: rawReason || null,
      expectedShipDate: rawReason ? rawDate || null : null,
    },
  };
}
