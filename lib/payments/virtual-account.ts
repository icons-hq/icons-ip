/**
 * 토스 가상계좌 입금 안내(ADR-0049)의 화면용 값. DB `get_my_order_virtual_account`가 돌려주는 모양이다.
 * - awaiting: 계좌가 발급됐고 기한 안이다(입금 안내를 보인다).
 * - checking: 기한이 지났거나 결제사 확인 중이다(계좌를 다시 약속하지 않는다).
 * - deposited: 입금이 확인됐다. closed: 입금 없이 닫혔다.
 */
export type OrderVirtualAccountState = 'awaiting' | 'deposited' | 'checking' | 'closed';

export interface OrderVirtualAccount {
  /** 토스 은행 코드(2·3자리). 이름은 `tossBankLabel`로 바꾼다. */
  readonly bankCode: string;
  readonly accountNumber: string;
  /** 입금 기한(ISO). */
  readonly dueAt: string;
  /** 입금할 금액(원). */
  readonly amount: number;
  /** 구매안전서비스(에스크로)를 고른 결제인지. */
  readonly useEscrow: boolean;
  readonly state: OrderVirtualAccountState;
}

const STATES: readonly string[] = ['awaiting', 'deposited', 'checking', 'closed'];

/** RPC 결과를 검증해 읽는다. 모양이 어긋나면 null — 화면은 계좌를 단정하지 않는다. */
export function parseOrderVirtualAccount(value: unknown): OrderVirtualAccount | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.bankCode !== 'string'
    || typeof row.accountNumber !== 'string'
    || typeof row.dueAt !== 'string'
    || typeof row.amount !== 'number'
    || typeof row.state !== 'string'
    || !STATES.includes(row.state)
  ) return null;
  return {
    bankCode: row.bankCode,
    accountNumber: row.accountNumber,
    dueAt: row.dueAt,
    amount: row.amount,
    useEscrow: row.useEscrow === true,
    state: row.state as OrderVirtualAccountState,
  };
}

/** 주문 결제 시도가 가상계좌 입금을 기다리는 상태인지. */
export function isAwaitingDepositAttempt(attempt: { readonly state: string } | null | undefined): boolean {
  return attempt?.state === 'awaiting_deposit';
}

export const VIRTUAL_ACCOUNT_COPY = {
  /** 입금자명·금액 안내. */
  depositNote: '입금자명은 주문자와 달라도 괜찮아요. 입금 금액은 안내된 금액과 정확히 같아야 해요.',
  deadlineNote: '입금 기한이 지나면 주문이 자동으로 취소돼요.',
  autoCheckNote: '입금 확인은 자동으로 이뤄져요. 보통 몇 분 안에 반영돼요.',
  escrowNote: '구매안전서비스(에스크로)가 적용된 결제예요. 배송이 완료되면 토스페이먼츠 구매확정 안내가 가요.',
} as const;

/**
 * 주문서 결제수단 칸의 카드 선택지 문구. 토스 가상계좌·계좌이체가 열려 있으면(`tossVirtualAccountCheckoutEnabled`, 서버 값) 같은
 * 토스 결제창에서 계좌이체·무통장입금(가상계좌)도 고를 수 있다 — 결제수단은 여전히 주문에 `card`로 고정된다(ADR-0049).
 */
export function cardMethodCopy(virtualAccountEnabled: boolean, cardNote: string): { label: string; note: string } {
  if (!virtualAccountEnabled) return { label: '신용·체크카드', note: cardNote };
  return {
    label: '카드·간편결제·계좌이체·무통장입금(가상계좌)',
    note: '토스페이먼츠 결제창에서 신용·체크카드, 간편결제, 계좌이체, 무통장입금(가상계좌) 중에 고를 수 있어요. 카드·간편결제·계좌이체는 결제 후 바로 확정되고 재고 선점은 15분이에요. 무통장입금은 주문한 뒤 안내되는 입금 기한까지 재고를 잡아 둬요.',
  };
}

export const VIRTUAL_ACCOUNT_ESCROW_CHECKOUT_NOTICE = '현금으로 결제할 때 토스페이먼츠 구매안전(에스크로) 서비스를 이용할 수 있어요.';
