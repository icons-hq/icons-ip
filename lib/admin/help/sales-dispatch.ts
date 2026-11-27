import type { AdminHelpBook } from './types';

/**
 * 발주(주문)확인/발송관리 화면의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 화면 구조·이름·확인창으로 풀리지 않는 개념에만 단다. 칸 이름을 바꾸면 이 글 안의 이름도 함께 바꾼다.
 */
export const SALES_DISPATCH_HELP = {
  delayNoticeResult: {
    what: '배송 건마다 가장 최근에 보낸 고객 지연 안내의 앱 알림·이메일 결과입니다. 미리보기만 저장한 안내는 세지 않습니다.',
    caution: "'발송 처리'는 앱 알림을 남기고 메일을 메일 발송 서비스에 넘겼다는 뜻입니다. 고객이 받았거나 읽었다는 뜻은 아닙니다.",
    where: '실패했거나 결과를 모르는 건은 발송 지연 탭의 [고객 지연 안내 이력·결과]에서 주문별로 봅니다.',
  },
} as const satisfies AdminHelpBook;

export type SalesDispatchHelpKey = keyof typeof SALES_DISPATCH_HELP;
