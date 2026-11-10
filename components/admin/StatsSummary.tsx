import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import type { AdminTone } from '@/lib/admin/status-tone';

/*
 * 데이터분석 화면의 공통 모양(ADR-0028 템플릿 룩). 판매·클레임·고객·시간대·유입 분석이 같은 요약 카드,
 * 구역 머리, 구분 선택을 쓴다. 판정·수치는 각 화면이 계산하고 여기서는 그리기만 한다.
 */

/** 구분 선택 묶음(셸의 콘솔 전환과 같은 모양). */
export const STATS_SEGMENTED = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';
const SEGMENT_ITEM = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';
/** 링크 탭 항목. 현재 항목은 aria-current(page·true)로 고른다. */
export const STATS_SEGMENT_LINK = `${SEGMENT_ITEM} aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm aria-[current=true]:bg-background aria-[current=true]:text-primary-soft-foreground aria-[current=true]:shadow-sm`;
/** 화면 안 상태로 고르는 버튼 항목(aria-pressed). */
export const STATS_SEGMENT_BUTTON = `${SEGMENT_ITEM} cursor-pointer aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm`;

/** 안내 문단(보조 글자). */
export const STATS_NOTE = 'text-sm text-muted-foreground';

/** 저장값 'YYYY-MM-DD'를 조회기간 입력칸과 같은 표기('2026. 10. 13.')로 읽는다. 월별 묶음('2026-10')은 '2026. 10.'이다. */
export function statsDateLabel(value: string) {
  return value.split('-').map(part => `${part}.`).join(' ');
}

/** 차트 가로축의 짧은 날짜('10. 13.'). 연도는 조회기간 칸과 툴팁이 말한다. 월별 묶음은 연도까지 그대로 읽는다. */
export function statsDateTick(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}. ${parts[2]}.` : statsDateLabel(value);
}

export type StatsChangeDirection = 'up' | 'down' | 'flat';
/** 오를수록 좋은 지표(higher)와 오르면 나쁜 지표(lower — 클레임·환불처럼). */
export type StatsChangePolarity = 'higher' | 'lower';
type StatsChangeTone = Extract<AdminTone, 'success' | 'danger' | 'neutral'>;

/**
 * 증감 색의 단일 규칙. 값의 크기가 아니라 방향만 본다 — 오름 success, 내림 danger, 변동 없음 neutral.
 * 오르면 나쁜 지표만 polarity="lower"로 뒤집는다. 데이터분석·홈의 모든 증감 표시가 이 함수를 지난다.
 */
export function statsChangeTone(direction: StatsChangeDirection, polarity: StatsChangePolarity = 'higher'): StatsChangeTone {
  if (direction === 'flat') return 'neutral';
  return (direction === 'up') === (polarity === 'higher') ? 'success' : 'danger';
}

/** 색만으로 오르내림을 전하지 않도록 화살표 글자를 함께 둔다. 숫자의 부호가 읽어 주는 값이라 스크린리더에는 감춘다. */
const CHANGE_GLYPHS = { up: '▲', down: '▼', flat: '–' } as const;
function StatsChangeGlyph({ direction }: { direction: StatsChangeDirection }) {
  return <span aria-hidden="true" className="text-[0.75em] leading-none">{CHANGE_GLYPHS[direction]}</span>;
}

/** 증감 방향. 어느 한쪽 값이 없으면(비교 불가) 방향이 없다. */
export function statsChangeDirection(current: number | null | undefined, previous: number | null | undefined): StatsChangeDirection {
  if (current == null || previous == null || current === previous) return 'flat';
  return current > previous ? 'up' : 'down';
}

type StatsChangeProps = { direction: StatsChangeDirection; polarity?: StatsChangePolarity; title?: string; children: ReactNode };

/** 증감 배지(요약 카드). 색은 statsChangeTone 하나로 정하고, 화살표와 부호 있는 글자로도 읽는다. */
export function StatsChangeBadge({ direction, polarity, title, className = '', children }: StatsChangeProps & { className?: string }) {
  return <AdminStatusBadge className={`tabular-nums before:hidden ${className}`} title={title} tone={statsChangeTone(direction, polarity)}><StatsChangeGlyph direction={direction} />{children}</AdminStatusBadge>;
}

const CHANGE_TEXT: Record<StatsChangeTone, string> = { success: 'text-success', danger: 'text-destructive', neutral: 'text-muted-foreground' };

/** 표 칸의 증감. 배지와 규칙·화살표는 같고 바탕만 뺀다 — 줄마다 반복되는 칸이 표를 색 덩어리로 만들지 않는다. */
export function StatsChangeText({ direction, polarity, title, children }: StatsChangeProps) {
  const tone = statsChangeTone(direction, polarity);
  return <span className={`inline-flex items-center gap-1 font-medium whitespace-nowrap tabular-nums ${CHANGE_TEXT[tone]}`} data-tone={tone} title={title}><StatsChangeGlyph direction={direction} />{children}</span>;
}

export function StatsSummaryGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] ${className}`} data-stats-summary="">{children}</div>;
}

const TILE_ATTENTION = {
  warning: { box: 'border-warning-border bg-warning-soft', value: 'text-warning' },
  danger: { box: 'border-danger-border bg-danger-soft', value: 'text-destructive' },
} as const;

/**
 * 요약 수치 카드. 숫자는 foreground이고, 보조 줄(children)은 비교값·안내를 담는다.
 * `tone`은 지금 처리할 건수가 있을 때만 켠다. `href`를 주면 처리 화면으로 가는 링크가 되고 화살표가 붙는다.
 */
export function StatsSummaryTile({ label, value, children, tone, href }: { label: ReactNode; value: ReactNode; children?: ReactNode; tone?: keyof typeof TILE_ATTENTION; href?: string }) {
  const attention = tone ? TILE_ATTENTION[tone] : null;
  const className = `flex min-w-0 flex-col gap-1 rounded-xl border px-4 py-3 text-card-foreground ${attention?.box ?? 'bg-card'}`;
  const body = <>
    <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">{label}{href ? <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /> : null}</span>
    <strong className={`text-2xl leading-tight font-semibold tabular-nums [overflow-wrap:anywhere]${attention ? ` ${attention.value}` : ''}`}>{value}</strong>
    {children}
  </>;
  return href ? <Link className={`${className} transition-colors hover:border-ring`} href={href}>{body}</Link> : <div className={className}>{body}</div>;
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
