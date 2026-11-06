import Link from 'next/link';

/** 칩 색 톤. 지연·반려처럼 운영자가 먼저 봐야 하는 건수를 구분한다. */
export type ConsoleChipTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface ConsoleCountChip {
  /** 상태 이름. 예: `'배송준비'`. */
  label: string;
  /** 건수. 0도 그대로 넘긴다 — 아래 컴포넌트가 숨기지 않는다. */
  count: number;
  /** 누르면 그 상태로 필터링되는 링크. 없으면 읽기 전용 칩이 된다. */
  href?: string;
  /** 현재 필터가 이 칩인지. `aria-current`와 강조 표시로 이어진다. */
  active?: boolean;
  tone?: ConsoleChipTone;
}

export interface ConsoleCountChipsProps {
  chips: ConsoleCountChip[];
  /** 묶음 라벨. 기본 `'상태별 건수'`. */
  label?: string;
  className?: string;
}

/**
 * 상태별 카운트 요약 칩.
 *
 * 0건인 상태도 반드시 렌더한다. 0건 칩을 감추면 운영자가 "정말 0건인지"와 "집계를 못
 * 불러온 건지"를 구분할 수 없다. 건수가 없다는 사실 자체가 화면에 남아야 한다.
 */
const TONE_COUNT_CLASS: Record<ConsoleChipTone, string> = {
  default: '',
  info: 'text-[var(--wc-info)]',
  success: 'text-[var(--wc-success)]',
  warning: 'text-[var(--wc-warning)]',
  danger: 'text-destructive',
};

/*
 * 상태별 건수 카드(템플릿 룩, ADR-0028 — 취소관리 kit 화면과 같은 모양). 0건도 숨기지 않고,
 * 링크 카드는 누르면 그 상태로 거른다. 현재 상태는 테두리·고리로 강조한다.
 */
export function ConsoleCountChips({
  chips,
  className,
  label = '상태별 건수',
}: ConsoleCountChipsProps) {
  return (
    <div
      aria-label={label}
      className={`${className ? `${className} ` : ''}grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]`}
      data-console-chips=""
      role="group"
    >
      {chips.map((chip) => {
        const count = chip.count.toLocaleString('ko-KR');
        const tone = chip.tone ?? 'default';
        const chipClassName = 'flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors data-[active]:border-primary data-[active]:ring-1 data-[active]:ring-primary';
        const body = (
          <>
            <span className="truncate text-xs text-muted-foreground">{chip.label}</span>
            <strong className={`text-xl leading-tight font-semibold tabular-nums ${chip.count > 0 ? TONE_COUNT_CLASS[tone] : ''}`}>
              {count}<span className="ml-0.5 text-xs font-normal text-muted-foreground">건</span>
            </strong>
          </>
        );
        /* 링크는 접근성 이름이 자식 텍스트를 이어붙인 "배송준비3"이 되어 단위가 사라진다.
           aria-label로 "배송준비 3건"을 명시한다. 정적 칩은 읽기 순서만으로 충분하므로
           aria-label을 붙이지 않는다 — 비대화형 요소의 aria-label은 지원이 고르지 않다. */
        return chip.href ? (
          <Link
            aria-current={chip.active ? 'true' : undefined}
            aria-label={`${chip.label} ${count}건`}
            className={`${chipClassName} hover:bg-accent`}
            data-active={chip.active || undefined}
            data-tone={tone}
            href={chip.href}
            key={chip.label}
          >
            {body}
          </Link>
        ) : (
          <span className={chipClassName} data-active={chip.active || undefined} data-tone={tone} key={chip.label}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
