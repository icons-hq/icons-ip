import type { AdminHelpBook } from './types';

/**
 * 발주(주문)확인/발송관리의 자동 발주확인 카드 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 이 카드의 "?"는 한 곳뿐이다 — 어떤 신규주문이 자동으로 발주확인되고 어떤 주문이 신규주문에 남는지는 이름만으로는 알 수 없다.
 * 가상계좌 입금 1시간 대기는 ADR-0025 보강(2026-11-24)이다. 칸 이름은 화면에 적힌 그대로 쓴다. 화면에서 바꾸면 여기도 함께 바꾼다.
 */
export const SALES_AUTO_ORDER_CONFIRM_HELP = {
  targets: {
    what: '켠 시각 뒤에 결제된 신규주문이 대상입니다. 취소 요청이 진행 중이거나 예약 입고 확인 전이거나 출고 보류 중인 주문은 신규주문에 남습니다.',
    caution: '가상계좌 주문은 입금을 확인한 지 1시간이 지나야 대상입니다. 실행 시각 1시간 안에 입금된 주문은 다음 날 처리합니다.',
  },
} as const satisfies AdminHelpBook;

export type SalesAutoOrderConfirmHelpKey = keyof typeof SALES_AUTO_ORDER_CONFIRM_HELP;
