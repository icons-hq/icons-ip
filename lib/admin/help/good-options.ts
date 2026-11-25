import type { AdminHelpBook } from './types';

/**
 * 상품 편집기의 옵션 편집 영역(옵션목록·옵션 상세 정보) "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 옵션명·옵션값·옵션가·재고수량은 good-editor.ts의 글을 그대로 쓴다. 여기에는 그 파일에 없는,
 * 이름이 비슷해 서로 헷갈리는 코드 칸의 구분만 둔다(docs/admin-copy-guide.md 원칙 3 — 2026-11-19 ERP 코드를 다른 칸에 넣은 일).
 * 칸 이름을 바꾸면 이 글 안의 칸 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다).
 */
export const GOOD_OPTIONS_HELP = {
  erpCode: {
    what: "받은 엑셀의 '코드'(품목코드)를 그대로 넣습니다. 0으로 시작하는 번호도 앞의 0까지 저장됩니다.",
    where: '거래확정 엑셀과 출고지시 엑셀에 찍힙니다.',
  },
  optionAutoCode: {
    what: '저장할 때 옵션마다 자동으로 만들어지는 번호라 적지 않아도 됩니다.',
    where: "출고지시 엑셀의 '옵션코드' 열에 찍힙니다.",
    caution: "ERP 코드와 다른 번호입니다. 받은 엑셀의 '코드'는 ERP 코드 칸에 넣습니다.",
  },
} as const satisfies AdminHelpBook;

export type GoodOptionsHelpKey = keyof typeof GOOD_OPTIONS_HELP;
