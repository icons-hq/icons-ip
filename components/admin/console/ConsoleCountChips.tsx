import type { LucideIcon } from 'lucide-react';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard, type AdminCountTone } from './AdminCountCard';

/** 칩 색 톤. 지연·반려처럼 운영자가 먼저 봐야 하는 건수를 구분한다. */
export type ConsoleChipTone = AdminCountTone;

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
  /** 상태 아이콘. 주지 않으면 tone 기본 아이콘을 쓴다. */
  icon?: LucideIcon;
}

export interface ConsoleCountChipsProps {
  chips: ConsoleCountChip[];
  /** 묶음 라벨. 기본 `'상태별 건수'`. */
  label?: string;
  className?: string;
}

/**
 * 상태별 건수 카드 묶음.
 *
 * 0건인 상태도 반드시 렌더한다. 0건 칩을 감추면 운영자가 "정말 0건인지"와 "집계를 못
 * 불러온 건지"를 구분할 수 없다. 건수가 없다는 사실 자체가 화면에 남아야 한다.
 */
export function ConsoleCountChips({ chips, className, label = '상태별 건수' }: ConsoleCountChipsProps) {
  return (
    <div aria-label={label} className={`${className ? `${className} ` : ''}${ADMIN_COUNT_CARD_GRID_CLASS}`} data-console-chips="" role="group">
      {chips.map((chip) => <AdminCountCard key={chip.label} {...chip} />)}
    </div>
  );
}
