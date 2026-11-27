import type { AdminHelpBook } from './types';

/**
 * 취소·반품·교환 상세의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 예전에 환불계좌 아래에 늘 적어 두던 세 문장을 칸 이름 옆으로 옮겼다. 버튼 이름을 바꾸면 이 글 안의 이름도 함께 바꾼다.
 */
export const CLAIM_DETAIL_HELP = {
  refundAccount: {
    what: '환불받을 계좌입니다. 번호 일부는 가려서 보여 주고, 전체 번호는 무통장 환불 담당자가 환불 처리 칸의 [계좌번호 전체 보기]로 확인합니다.',
    caution: '전체 번호를 볼 때마다 본 사람과 시각이 기록됩니다. 요청이 끝나거나 교환으로 바뀐 지 30일이 지나면 전체 번호는 지워집니다.',
  },
} as const satisfies AdminHelpBook;

export type ClaimDetailHelpKey = keyof typeof CLAIM_DETAIL_HELP;
