import type { AdminHelpBook } from './types';

/**
 * 취소·반품·교환 목록의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 예전에 표 아래에 늘 적어 두던 약관 문단을 칸 이름 옆으로 옮겼다. 칸 이름을 바꾸면 이 글 안의 이름도 함께 바꾼다.
 */
export const CLAIM_QUEUE_HELP = {
  refundDue: {
    what: '고객에게 환불해야 하는 마감입니다. 약관 제16조에 따라 회수 확인 때 적은 실제 입고일(출고지가 여럿이면 가장 늦은 날)부터 3영업일입니다.',
    caution: '입고 전이거나 상품을 돌려받지 않는 요청은 기한이 없어 -로 보입니다.',
  },
} as const satisfies AdminHelpBook;

export type ClaimQueueHelpKey = keyof typeof CLAIM_QUEUE_HELP;
