/*
 * 설정·배송·정책·운영자 화면이 함께 쓰는 kit 모양 클래스(ADR-0028 템플릿 룩). 옛 화면 CSS가 라벨·안내·알림을
 * 요소 선택자로 꾸미던 자리를 유틸리티 한 벌로 대신한다. 판정·문구는 각 화면이 그대로 갖는다.
 */

/** 라벨 글자 위·입력 아래로 쌓는 라벨(입력을 감싼다). 안쪽 입력 글자는 보통 굵기로 둔다. */
export const FIELD_LABEL = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium [&_input]:font-normal [&_select]:font-normal [&_textarea]:font-normal';
/** 체크박스·라디오와 글자를 한 줄로 두는 라벨. */
export const CHECK_LABEL = 'flex w-fit max-w-full items-center gap-2 text-sm';
/** 긴 확인 문구용 — 체크박스를 첫 줄 위에 맞춘다(체크박스에 mt-0.5). */
export const CHECK_LABEL_TOP = 'flex w-fit max-w-full items-start gap-2 text-sm';
/** 입력 아래 보조 설명(라벨 안의 small 등). */
export const FIELD_HINT = 'text-xs leading-relaxed font-normal text-muted-foreground';
/** 입력 옆 오류 글자. */
export const FIELD_ERROR = 'text-sm font-normal text-destructive';
/** 본문 안내 문단. */
export const NOTE = 'text-sm leading-relaxed text-muted-foreground';
/** 오류 알림 상자(role="alert"). */
export const ALERT_BOX = 'rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive';
/** 일반 안내·진행 상자(role="status"). */
export const STATUS_BOX = 'rounded-lg border bg-muted/40 px-3 py-2.5 text-sm';
/** 저장 완료 안내 상자(role="status"). */
export const SUCCESS_BOX = 'rounded-lg border bg-muted/40 px-3 py-2.5 text-sm font-medium text-[var(--wc-success)]';
/** 회색 정보 상자(현재 설정·복구 안내 등). */
export const INFO_PANEL = 'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/40 p-3 text-sm [overflow-wrap:anywhere]';
/** 버튼 줄. */
export const ACTIONS = 'flex flex-wrap items-center gap-2';
/** 조회 조건 카드(GET 폼). */
export const FILTER_CARD = 'flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border bg-card p-4 text-card-foreground';
/** 목록 카드 머리(제목·건수·보조 문구). */
export const RESULT_HEADING = 'flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3';
/** 직접 그린 표의 바깥 상자. */
export const TABLE_BOX = 'min-w-0 overflow-hidden rounded-lg border bg-card';
/** 높이를 제한하고 안에서 스크롤하는 표 상자(팝업 안 긴 목록). */
export const TABLE_SCROLL = 'max-h-[28.75rem] min-w-0 overflow-auto rounded-lg border bg-card';
/** 스프레드시트 붙여넣기 칸(고정폭 글자, 줄바꿈 없음). kit Textarea의 md:text-sm까지 덮는다. */
export const TSV_TEXTAREA = 'field-sizing-fixed font-mono text-xs whitespace-pre md:text-xs';
/** 빈 목록 안내. */
export const EMPTY = 'px-4 py-10 text-center text-sm text-muted-foreground';
/** 링크 탭 묶음과 항목(셸의 콘솔 전환과 같은 모양). */
export const SEGMENTED = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';
export const SEGMENT_LINK = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm aria-[current=true]:bg-background aria-[current=true]:text-foreground aria-[current=true]:shadow-sm';
