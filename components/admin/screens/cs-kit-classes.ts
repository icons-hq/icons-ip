/*
 * 문의·리뷰·고객 화면이 함께 쓰는 kit 모양 클래스(ADR-0028). 화면 전용 CSS 대신 유틸리티 문자열로 둔다.
 *
 * - 네이티브 입력: kit Input·Textarea(components/admin/kit/ui)와 같은 클래스다. 비제어 제출·defaultValue·테스트가
 *   네이티브 요소 자체에 기대는 곳에서만 쓰고, 그 밖에서는 kit 부품을 쓴다. data-slot을 함께 달아
 *   옛 관리자 CSS(:not([data-slot]))가 닿지 않게 한다.
 * - 구분 선택: 셸의 콘솔 전환·조회기간 프리셋과 같은 모양.
 */

/** `<input data-slot="input">` — kit Input과 같은 모양. */
export const KIT_INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm';

/** `<textarea data-slot="textarea">` — kit Textarea와 같은 모양(높이는 min-h로 정한다). */
export const KIT_TEXTAREA_CLASS = 'flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm';

/** 링크·버튼 구분 선택의 바탕. */
export const KIT_SEGMENT_CLASS = 'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5';

/** 구분 선택 한 칸. 현재 칸은 aria-current(링크) 또는 aria-pressed(버튼)로 표시한다. */
export const KIT_SEGMENT_ITEM_CLASS = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm aria-[current=true]:bg-background aria-[current=true]:text-foreground aria-[current=true]:shadow-sm aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm';

/** 문의 1차 답변 기한(SLA) 톤. 톤은 data-sla-tone으로 남기고(테스트·색 외 단서) 그 값으로 강조한다. */
export const INQUIRY_SLA_TONE_CLASS = 'data-[sla-tone=danger]:font-semibold data-[sla-tone=danger]:text-destructive data-[sla-tone=warning]:font-medium data-[sla-tone=warning]:text-[var(--wc-warning)] data-[sla-tone=settled]:text-muted-foreground';

/** 입력 위 라벨 글자(kit Label과 같은 크기·굵기). 네이티브 label이 입력을 감쌀 때 글자 span에 쓴다. */
export const FIELD_LABEL_CLASS = 'text-sm leading-none font-medium text-foreground';

/** 입력 아래 글자 수. */
export const COUNTER_CLASS = '-mt-1.5 self-end text-xs text-muted-foreground tabular-nums';

/* 답변 템플릿 도구(고객문의·상품문의·리뷰 공용). */
export const TEMPLATE_SEARCH_CLASS = 'flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3';
export const TEMPLATE_NOTICE_CLASS = 'flex flex-wrap items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--wc-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--wc-warning)_6%,transparent)] px-3 py-2 text-sm';
export const TEMPLATE_ROW_CLASS = 'flex min-w-0 flex-col gap-2 rounded-lg border p-3.5';
export const TEMPLATE_BODY_CLASS = 'max-h-40 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere';
export const TEMPLATE_EDITOR_CLASS = 'flex flex-col gap-3 border-t pt-5';
export const LATEST_CLASS = 'flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm';

/** 상담하기 오른쪽 상담 정보 칸의 카드. */
export const CHAT_CONTEXT_CARD_CLASS = 'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground wrap-anywhere';
