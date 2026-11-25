import type { AdminHelpBook } from './types';

/**
 * 상품 등록 화면 '상품과 함께 저장할 설정' 가운데 공급가 칸의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 추가 구성 상품·배송비 묶음그룹·진열 순서의 도움말은 `good-editor.ts`(GOOD_EDITOR_HELP)를 그대로 쓴다.
 * 칸 이름을 바꾸면 이 글 안의 칸 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다).
 */
export const GOOD_PICKERS_B_HELP = {
  purchaseTaxBasis: {
    what: '공급가에 세금이 들어 있는지 고릅니다. 세금 포함은 이미 들어 있고, 세금 별도는 따로 더해지며, 면세는 세금이 없는 상품입니다.',
    when: '금액을 넣을 때 함께 고릅니다. 정하지 않은 옵션은 금액과 세금 처리를 모두 비워 둡니다.',
  },
} as const satisfies AdminHelpBook;

export type GoodPickersBHelpKey = keyof typeof GOOD_PICKERS_B_HELP;
