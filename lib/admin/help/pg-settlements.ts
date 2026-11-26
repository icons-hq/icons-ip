import type { AdminHelpBook } from './types';

/**
 * 정산 내역(결제사 정산 자료)의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 이 화면의 "?"는 한 곳뿐이다 — 이름과 구조로 드러나지 않는 것은 지급액이 무엇을 뜻하는지(은행 입금이 아니다)뿐이다.
 * 표 머리글은 글자만 받아 열 이름 옆에는 달 수 없어서, 지급액이 처음 나오는 '기간 합계' 제목 옆에 단다.
 * 칸 이름은 화면에 적힌 그대로 쓴다. 화면에서 바꾸면 여기도 함께 바꾼다.
 */
export const PG_SETTLEMENTS_HELP = {
  payout: {
    what: '지급액은 결제사가 알려 준 금액입니다. 은행에 실제로 들어온 금액은 은행 거래 내역으로 확인합니다.',
    caution: '승인과 취소는 따로 합산하고, 둘을 뺀 순입금액은 계산하지 않습니다. 수수료는 소수 값 그대로 보입니다.',
  },
} as const satisfies AdminHelpBook;

export type PgSettlementsHelpKey = keyof typeof PG_SETTLEMENTS_HELP;
