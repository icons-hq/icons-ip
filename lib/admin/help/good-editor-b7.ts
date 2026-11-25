import type { AdminHelpBook } from './types';

/**
 * 상품 등록·수정 화면의 "?" 도움말 가운데 연결 IP와 상품정보제공고시 템플릿(docs/admin-screen-rules.md 규칙 3).
 * 칸 이름을 바꾸면 이 글 안의 칸 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다).
 */
export const GOOD_EDITOR_B7_HELP = {
  /* ── 기본 정보 ── */
  connectedIp: {
    what: '상품이 속한 브랜드·작품입니다. IP가 공개돼 있어야 이 상품도 고객에게 보입니다.',
  },

  /* ── 상품정보제공고시 ── */
  noticeTemplate: {
    what: '미리 만들어 둔 템플릿에 적힌 칸을 한 번에 채웁니다. 템플릿에서 비워 둔 칸은 지금 값 그대로 둡니다.',
    caution: '적어 둔 값이 바뀌는 칸이 있으면 어느 칸인지 보여 주고 바꾸기 전에 한 번 묻습니다.',
  },
} as const satisfies AdminHelpBook;

export type GoodEditorB7HelpKey = keyof typeof GOOD_EDITOR_B7_HELP;
