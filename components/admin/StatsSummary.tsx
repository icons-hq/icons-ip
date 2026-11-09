import type { ReactNode } from 'react';

/*
 * 데이터분석 화면의 공통 모양(ADR-0028 템플릿 룩). 판매·클레임·고객·시간대·유입 분석이 같은 요약 카드,
 * 구역 머리, 구분 선택을 쓴다. 판정·수치는 각 화면이 계산하고 여기서는 그리기만 한다.
 */

/** 구분 선택 묶음(셸의 콘솔 전환과 같은 모양). */
export const STATS_SEGMENTED = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';
const SEGMENT_ITEM = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';
/** 링크 탭 항목. 현재 항목은 aria-current(page·true)로 고른다. */
export const STATS_SEGMENT_LINK = `${SEGMENT_ITEM} aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm aria-[current=true]:bg-background aria-[current=true]:text-foreground aria-[current=true]:shadow-sm`;
/** 화면 안 상태로 고르는 버튼 항목(aria-pressed). */
export const STATS_SEGMENT_BUTTON = `${SEGMENT_ITEM} cursor-pointer aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm`;

/** 안내 문단(보조 글자). */
export const STATS_NOTE = 'text-sm text-muted-foreground';

export function StatsSummaryGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] ${className}`} data-stats-summary="">{children}</div>;
}

/** 요약 수치 카드. 숫자는 foreground이고, 보조 줄(children)은 비교값·안내를 담는다. */
export function StatsSummaryTile({ label, value, children }: { label: ReactNode; value: ReactNode; children?: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-card-foreground">
    <span className="text-sm text-muted-foreground">{label}</span>
    <strong className="text-2xl leading-tight font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</strong>
    {children}
  </div>;
}

/**
 * 표·목록 하나의 구역 — 콘솔 목록 카드(ConsoleListCard)와 같은 흰 카드 안에 머리(제목 + 오른쪽 동작)와 표를 담는다.
 * 데이터분석 화면의 목록이 셸 위에 바로 놓이지 않고 주문 목록과 같은 카드에 선다.
 */
export function StatsSection({ title, titleId, actions, children, className = '', ...rest }: {
  title: ReactNode; titleId?: string; actions?: ReactNode; children: ReactNode; className?: string;
  'aria-label'?: string; id?: string;
}) {
  return <section aria-labelledby={rest['aria-label'] ? undefined : titleId} className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground ${className}`} data-console-list="" {...rest}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base leading-snug font-medium" id={titleId}>{title}</h3>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {children}
  </section>;
}
