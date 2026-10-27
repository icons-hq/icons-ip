/**
 * 무통장 입금의 순수 규칙 (#256).
 *
 * 법인계좌 값 자체는 여기 없다 — 서버 설정에서만 읽는다(`bank-transfer.server.ts`).
 * 이 모듈은 값이 무엇이든 성립하는 규칙, 즉 입금자명 코드와 기한 표기만 안다.
 */
import { isCommerceNumber } from '@/lib/commerce-number';

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

const DEPOSIT_CODE_EPOCH = Date.UTC(2000, 0, 1);

/**
 * 입금자명에 붙일 주문코드(입금코드).
 *
 * 16자리 주문번호(`YYYYMMDD` + `1` + 일련 7자리)에서 만든다 — 주문일의 10일 주기 자리 1자리
 * (`(주문일 - 2000-01-01) mod 10`) + 그날 일련번호 끝 5자리, 숫자 6자리다. 입금 대기는 최대
 * 48시간이라 동시에 열린 주문의 주문일은 연속한 3일 안이고, 하루 주문이 10만 건을 넘지 않는 한
 * 입금 대기 주문 사이 코드가 겹치지 않는다. 한글 4자 이름과 붙여도 은행 입금자명 14바이트 안이다.
 *
 * DB `private.bank_transfer_deposit_code`와 **같은 규칙**이어야 한다 — 어긋나면 화면이 안내한
 * 코드로 운영자가 검색해도 주문이 나오지 않는다. 주문번호가 없는 옛 기록(UUID)만 옛 규칙
 * (UUID 앞 8자리)으로 계산한다.
 *
 * 안내된 코드는 바꾸지 않는다: DB는 이 규칙으로 바꾼 시각(migration 적용 시각) 전에 만든 주문에
 * 그때 안내한 옛 코드를 계속 쓴다. 그 시각은 DB만 알므로, 주문서처럼 이미 만든 주문의 코드를
 * 보여줄 때는 `get_my_bank_transfer_deposit_code`(고객)나 미입금 조회의 deposit_code(운영자)를
 * `bankTransferDepositNameWithCode`로 쓴다.
 */
export function bankTransferDepositCode(orderReference: string) {
  if (!isCommerceNumber(orderReference, 'order')) return bankTransferLegacyDepositCode(orderReference);
  const day = Date.UTC(Number(orderReference.slice(0, 4)), Number(orderReference.slice(4, 6)) - 1, Number(orderReference.slice(6, 8)));
  const cycle = Math.round((day - DEPOSIT_CODE_EPOCH) / 86_400_000) % 10;
  return `${(cycle + 10) % 10}${orderReference.slice(-5)}`;
}

/** 주문번호 도입 전 규칙(UUID 앞 8자리). 옛 코드를 안내받은 입금도 대조할 수 있게 남긴다. */
export function bankTransferLegacyDepositCode(orderId: string) {
  return orderId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** DB가 준 입금코드로 주문서·미입금 콘솔에 노출할 입금자명 예시를 만든다. */
export function bankTransferDepositNameWithCode(recipientName: string, code: string) {
  const trimmed = recipientName.trim();
  return trimmed ? `${trimmed}${code}` : code;
}

/** 주문서에 노출할 입금자명 예시. `orderReference`는 16자리 주문번호다(없는 옛 기록만 UUID). */
export function bankTransferDepositName(recipientName: string, orderReference: string) {
  return bankTransferDepositNameWithCode(recipientName, bankTransferDepositCode(orderReference));
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

/**
 * 무통장 입금 기한이 지났는지. 기한을 모르면 지난 것으로 본다(입금을 약속하지 않는다).
 * 서버 화면(주문 완료)과 클라이언트 시계(BankTransferDeadlineGate)가 함께 쓰므로 'use client' 모듈에 두지 않는다.
 */
export function bankTransferDeadlinePassed(expiresAt: string | null, now: number): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  return !Number.isFinite(deadline) || deadline <= now;
}
