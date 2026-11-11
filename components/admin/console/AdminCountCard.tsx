import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleDot, Clock, Info } from 'lucide-react';

/** 건수 카드 색 톤. 지연·반려처럼 운영자가 먼저 봐야 하는 건수를 구분한다. */
export type AdminCountTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<AdminCountTone, LucideIcon> = {
  default: CircleDot,
  info: Info,
  success: CheckCircle2,
  warning: Clock,
  danger: AlertTriangle,
};

/* 건수가 있을 때만 색이 켜진다 — 0건은 회색으로 물러나 처리할 것만 눈에 띈다(ADR-0029). */
const TONE_ICON_CLASS: Record<AdminCountTone, string> = {
  default: 'bg-muted text-muted-foreground',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-destructive',
};

const TONE_COUNT_CLASS: Record<AdminCountTone, string> = {
  default: 'text-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

const CARD_CLASS = 'flex min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors';
const ACTIVE_CLASS = 'border-primary bg-primary-soft ring-1 ring-primary';

export interface AdminCountCardProps {
  label: string;
  /** 건수. 0도 그대로 넘긴다. `null`이면 집계를 못 읽은 상태로 '—'를, `undefined`이면 숫자 없이 라벨만 그린다. */
  count?: number | null;
  /** 누르면 그 상태로 거르는 링크. 없으면 읽기 전용 카드다. */
  href?: string;
  /** 현재 선택된 카드. 링크면 `aria-current`로 이어진다. */
  active?: boolean;
  /** 링크일 때 `aria-current` 값. 기본 `'true'`. */
  current?: 'page' | 'true';
  tone?: AdminCountTone;
  icon?: LucideIcon;
  unit?: string;
}

/**
 * 건수 카드 하나 — 상태별 건수 칩(ConsoleCountChips)·판매 단계 카드·상품 상태 카드가 같은 모양을 쓴다.
 * 색만으로 뜻을 전하지 않도록 라벨·숫자·단위를 항상 글자로 보인다.
 */
export function AdminCountCard({ label, count, href, active = false, current = 'true', tone = 'default', icon, unit = '건' }: AdminCountCardProps) {
  const reading = count === undefined || count === null ? '—' : count.toLocaleString('ko-KR');
  const lit = (count ?? 0) > 0;
  const Icon = icon ?? TONE_ICON[tone];
  const body = (
    <>
      <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${lit ? TONE_ICON_CLASS[tone] : 'bg-muted text-muted-foreground'}`}>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {count === undefined ? null : <strong className={`text-lg leading-tight font-semibold tabular-nums ${lit ? TONE_COUNT_CLASS[tone] : 'text-foreground'}`}>
          {reading}{count === null ? null : <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
        </strong>}
      </span>
    </>
  );
  /* 링크는 접근성 이름이 자식 텍스트를 이어붙인 "배송준비3"이 되어 단위가 사라진다. aria-label로 "배송준비 3건"을 명시한다. */
  return href ? (
    <Link
      aria-current={active ? current : undefined}
      aria-label={count === undefined ? label : count === null ? `${label} 집계 없음` : `${label} ${reading}${unit}`}
      className={`${CARD_CLASS} hover:bg-accent${active ? ` ${ACTIVE_CLASS}` : ''}`}
      data-active={active || undefined}
      data-tone={tone}
      href={href}
    >
      {body}
    </Link>
  ) : (
    <span className={`${CARD_CLASS}${active ? ` ${ACTIVE_CLASS}` : ''}`} data-active={active || undefined} data-tone={tone}>{body}</span>
  );
}

/** 건수 카드 줄의 칸 나누기(좁으면 두 칸). */
export const ADMIN_COUNT_CARD_GRID_CLASS = 'grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]';
