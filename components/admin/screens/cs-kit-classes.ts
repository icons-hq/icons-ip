import type { AdminCountTone } from '@/components/admin/console/AdminCountCard';
import { statusTone, type AdminStatusDomain } from '@/lib/admin/status-tone';

/*
 * 문의·리뷰·고객 화면이 함께 쓰는 kit 모양 클래스(ADR-0028). 화면 전용 CSS 대신 유틸리티 문자열로 둔다.
 *
 * - 네이티브 입력: kit Input·Textarea(components/admin/kit/ui)와 같은 클래스다. 비제어 제출·defaultValue·테스트가
 *   네이티브 요소 자체에 기대는 곳에서만 쓰고, 그 밖에서는 kit 부품을 쓴다. data-slot을 함께 달아
 *   옛 관리자 CSS(:not([data-slot]))가 닿지 않게 한다.
 * - 구분 선택: 셸의 콘솔 전환·조회기간 프리셋과 같은 모양.
 */

/** 상태 표(status-tone)를 건수 카드 색으로 — 표의 neutral은 건수 카드의 기본 모양이다(ADR-0029). */
export function csChipTone(domain: AdminStatusDomain, status: string): AdminCountTone {
  const tone = statusTone(domain, status);
  return tone === 'neutral' ? 'default' : tone;
}

/** `<input data-slot="input">` — kit Input과 같은 모양. */
export const KIT_INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm';

/** `<textarea data-slot="textarea">` — kit Textarea와 같은 모양. 높이(min-h-*)는 쓰는 곳이 정한다(겹치는 유틸리티를 만들지 않게). */
export const KIT_TEXTAREA_CLASS = 'flex w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm';

/** 링크·버튼 구분 선택의 바탕. */
export const KIT_SEGMENT_CLASS = 'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5';

/** 구분 선택 한 칸. 현재 칸은 aria-current(링크) 또는 aria-pressed(버튼)로 표시하고 주 색 글자로 강조한다(현재 위치, ADR-0029). */
export const KIT_SEGMENT_ITEM_CLASS = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm aria-[current=true]:bg-background aria-[current=true]:text-primary-soft-foreground aria-[current=true]:shadow-sm aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/** 문의 1차 답변 기한(SLA) 톤. 톤은 data-sla-tone으로 남기고(테스트·색 외 단서) 그 값으로 강조한다. */
export const INQUIRY_SLA_TONE_CLASS = 'data-[sla-tone=danger]:font-semibold data-[sla-tone=danger]:text-destructive data-[sla-tone=warning]:font-medium data-[sla-tone=warning]:text-warning data-[sla-tone=settled]:text-muted-foreground';

/** 줄마다 반복되는 위험 버튼(숨김·회수)의 빨간 글자. kit outline 위에 얹어 화면에서 제일 튀지 않게 한다. 확인 팝업은 각 화면이 유지한다. */
export const ROW_DANGER_BUTTON_CLASS = 'text-destructive hover:text-destructive aria-expanded:text-destructive';

/*
 * 실시간 연결 안내(components/screens/InquiryLiveUpdates)는 공개 화면과 함께 쓰는 부품이라 어드민이 감싸는 쪽에서 모양을 준다.
 * 연결이 끊겨도 목록과 답변은 그대로 쓸 수 있어 처리할 일이 아니다 — 주의색 상자로 화면 맨 위를 차지하지 않고 조용한 한 줄로 둔다.
 * 새 메시지 알림(button)은 보조 버튼 모양이다. 비어 있으면 자리를 차지하지 않는다.
 */
export const INQUIRY_LIVE_CLASS = "[&_.inquiry-live:empty]:hidden [&_.inquiry-live]:flex [&_.inquiry-live]:flex-col [&_.inquiry-live]:gap-2 [&_.inquiry-live>p]:flex [&_.inquiry-live>p]:flex-wrap [&_.inquiry-live>p]:items-center [&_.inquiry-live>p]:gap-x-2 [&_.inquiry-live>p]:rounded-md [&_.inquiry-live>p]:bg-muted/60 [&_.inquiry-live>p]:px-3 [&_.inquiry-live>p]:py-1.5 [&_.inquiry-live>p]:text-xs [&_.inquiry-live>p]:text-muted-foreground [&_.inquiry-live_p_button]:cursor-pointer [&_.inquiry-live_p_button]:font-medium [&_.inquiry-live_p_button]:text-foreground [&_.inquiry-live_p_button]:underline [&_.inquiry-live_p_button]:underline-offset-4 [&_.inquiry-live>button]:h-7 [&_.inquiry-live>button]:w-fit [&_.inquiry-live>button]:cursor-pointer [&_.inquiry-live>button]:rounded-lg [&_.inquiry-live>button]:border [&_.inquiry-live>button]:border-primary/35 [&_.inquiry-live>button]:bg-primary-soft [&_.inquiry-live>button]:px-2.5 [&_.inquiry-live>button]:text-xs [&_.inquiry-live>button]:font-semibold [&_.inquiry-live>button]:text-primary-soft-foreground";

/** 입력 위 라벨 글자(kit Label과 같은 크기·굵기). 네이티브 label이 입력을 감쌀 때 글자 span에 쓴다. */
export const FIELD_LABEL_CLASS = 'text-sm leading-none font-medium text-foreground';

/** 입력 아래 글자 수. */
export const COUNTER_CLASS = '-mt-1.5 self-end text-xs text-muted-foreground tabular-nums';

/* 답변 템플릿 도구(고객문의·상품문의·리뷰 공용). */
export const TEMPLATE_SEARCH_CLASS = 'flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3';
export const TEMPLATE_NOTICE_CLASS = 'flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm';
export const TEMPLATE_ROW_CLASS = 'flex min-w-0 flex-col gap-2 rounded-lg border p-3.5';
export const TEMPLATE_BODY_CLASS = 'max-h-40 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere';
export const TEMPLATE_EDITOR_CLASS = 'flex flex-col gap-3 border-t pt-5';
export const LATEST_CLASS = 'flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm';

/** 상담하기 오른쪽 상담 정보 칸의 카드. */
export const CHAT_CONTEXT_CARD_CLASS = 'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground wrap-anywhere';

/* 상품문의·리뷰 상세 팝업(레코드) 공용. */
/** 레코드 요약(dl). 칸은 RECORD_META_ITEM_CLASS(div > dt + dd). */
export const RECORD_META_CLASS = 'grid gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2';
export const RECORD_META_ITEM_CLASS = 'flex min-w-0 flex-col gap-0.5 [&>dt]:text-xs [&>dt]:text-muted-foreground [&>dd]:wrap-anywhere';
/** 원문·저장본 같은 본문 구역. h3 + p. */
export const RECORD_SECTION_CLASS = 'flex min-w-0 flex-col gap-2 rounded-lg border p-4 [&>h3]:text-sm [&>h3]:font-medium [&>h3]:text-foreground [&>p]:text-sm [&>p]:leading-relaxed [&>p]:whitespace-pre-wrap [&>p]:wrap-anywhere';
/** 저장본이 바뀌었다는 경고 구역. */
export const RECORD_CHANGED_CLASS = `${RECORD_SECTION_CLASS} border-warning-border bg-warning-soft`;
/** 답변·답글 작성 폼. */
export const REPLY_FORM_CLASS = 'flex flex-col gap-3 rounded-lg border bg-muted/40 p-4';
/** 서버 액션 결과(오류·완료). 비어 있으면 자리를 차지하지 않는다. */
export const ACTION_FEEDBACK_CLASS = 'flex flex-col gap-1 text-sm empty:hidden [&>[role=alert]]:text-destructive [&>[role=status]]:text-success';
/** 노출 관리처럼 접어 두는 위험 작업 구역의 펼침 줄. */
export const DISCLOSURE_SUMMARY_CLASS = 'flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden';
