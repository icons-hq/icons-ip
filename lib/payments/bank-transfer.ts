/**
 * 무통장 입금의 순수 규칙 (#256).
 *
 * 법인계좌 값 자체는 여기 없다 — 서버 설정에서만 읽는다(`bank-transfer.server.ts`).
 * 이 모듈은 값이 무엇이든 성립하는 규칙, 즉 입금자명 코드와 기한 표기만 안다.
 */

/** 입금 대기 창. DB `place_order`의 24시간과 같은 값이어야 한다. */
export const BANK_TRANSFER_HOLD_HOURS = 24;

export interface BankTransferAccount {
  /** 은행명. 예: 국민은행 */
  readonly bank: string;
  /** 계좌번호. 표기 그대로 쓴다 — 하이픈 정규화는 하지 않는다. */
  readonly accountNumber: string;
  /** 예금주(법인명). */
  readonly holder: string;
}

/**
 * 입금자명에 붙일 주문코드.
 *
 * 주문 id는 UUID라 입금자명 칸에 들어가지 않는다. DB
 * `private.bank_transfer_deposit_code`와 **같은 규칙**이어야 한다 — 어긋나면
 * 화면이 안내한 코드로 운영자가 검색해도 주문이 나오지 않는다.
 */
export function bankTransferDepositCode(orderId: string) {
  return orderId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** 주문서에 노출할 입금자명 예시. */
export function bankTransferDepositName(recipientName: string, orderId: string) {
  const trimmed = recipientName.trim();
  const code = bankTransferDepositCode(orderId);
  return trimmed ? `${trimmed}${code}` : code;
}

/**
 * 남은 입금 시간. 카드 결제 카운트다운(분:초)과 달리 시간 단위로 읽어야
 * 은행 영업시간을 가늠할 수 있다.
 */
export function bankTransferDeadlineLabel(expiresAt: string | null, now: number) {
  if (!expiresAt) return '기한 정보 없음';
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return '기한 종료';

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
  return `${minutes}분 남음`;
}

/** 기한이 임박한 미입금 주문. 콘솔에서 강조 대상을 고르는 기준. */
export function bankTransferDeadlineImminent(
  expiresAt: string | null,
  now: number,
  thresholdHours = 3,
) {
  if (!expiresAt) return false;
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining)
    && remaining > 0
    && remaining <= thresholdHours * 3_600_000;
}
