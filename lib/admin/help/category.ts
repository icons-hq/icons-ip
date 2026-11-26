import type { AdminHelpBook } from './types';

/**
 * 카테고리 관리 화면의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 화면 구조와 이름으로 풀리지 않는 개념에만 단다. 칸 이름을 바꾸면 이 글 안의 이름도 함께 바꾼다.
 */
export const CATEGORY_HELP = {
  customerCategories: {
    what: '쇼핑몰의 카테고리 메뉴와 카테고리별 상품 목록을 고객에게 보일지 정합니다. 켜거나 끄면 고객 화면에 바로 반영됩니다.',
    where: '고객이 보는 카테고리 이름과 순서는 카테고리 전시 관리에서 만든 대로 나옵니다.',
    caution: '꺼도 상품은 그대로 판매됩니다. 꺼 둔 동안 고객은 전체 상품 목록에서 상품을 찾습니다.',
  },
} as const satisfies AdminHelpBook;
