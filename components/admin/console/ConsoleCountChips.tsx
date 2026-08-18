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
export function ConsoleCountChips({
  chips,
  className,
  label = '상태별 건수',
}: ConsoleCountChipsProps) {
  return (
    <div
      aria-label={label}
      className={`${className ? `${className} ` : ''}admin-console-chips`}
      role="group"
    >
      {chips.map((chip) => {
        const count = chip.count.toLocaleString('ko-KR');
        const chipClassName = `admin-console-chip admin-console-chip--${chip.tone ?? 'default'}${
          chip.active ? ' on' : ''
        }`;
        const body = (
          <>
            <span className="admin-console-chip-label">{chip.label}</span>
            <strong className="admin-console-chip-count">{count}</strong>
          </>
        );
        /* 링크는 접근성 이름이 자식 텍스트를 이어붙인 "배송준비3"이 되어 단위가 사라진다.
           aria-label로 "배송준비 3건"을 명시한다. 정적 칩은 읽기 순서만으로 충분하므로
           aria-label을 붙이지 않는다 — 비대화형 요소의 aria-label은 지원이 고르지 않다. */
        return chip.href ? (
          <Link
            aria-current={chip.active ? 'true' : undefined}
            aria-label={`${chip.label} ${count}건`}
            className={chipClassName}
            href={chip.href}
            key={chip.label}
          >
            {body}
          </Link>
        ) : (
          <span className={chipClassName} key={chip.label}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
