import type { CSSProperties } from 'react';

/*
 * 어드민 차트의 kit 모양(ADR-0028). recharts는 CSS 클래스가 아니라 속성값으로 색을 받으므로 kit 토큰을
 * var()로 넘긴다. 계열 색은 화면이 var(--chart-1..5)에서 고른다.
 */
export const CHART_GRID_STROKE = 'var(--border)';
/** "현재 vs 비교" 두 계열의 색 — 현재는 범주 1번(주 색), 비교는 회색으로 물러난다(ADR-0029). 선 모양(실선·점선)으로도 구분한다. */
export const CHART_CURRENT = 'var(--chart-1)';
export const CHART_COMPARISON = 'var(--chart-comparison)';
export const CHART_AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;

export const CHART_TOOLTIP_STYLE: { content: CSSProperties; item: CSSProperties; label: CSSProperties } = {
  content: {
    backgroundColor: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 4px 12px color-mix(in oklab, var(--foreground) 8%, transparent)',
    color: 'var(--popover-foreground)',
    fontSize: 12,
  },
  item: { color: 'var(--muted-foreground)' },
  label: { color: 'var(--foreground)', fontWeight: 600 },
};
