import type { ReactNode } from 'react';

export interface ProductGridProps {
  /** 각 자식은 `<li>`다. */
  children: ReactNode;
  /** 줄 간격만 다르다 — 홈 모음(home)은 촘촘하고 목록(listing)은 넉넉하다. */
  density?: 'home' | 'listing';
  className?: string;
  /** 있으면 목록의 접근 이름으로 쓴다. */
  label?: string;
}

/*
 * 상품 그리드 (X SQUARE 공용 부품 계약 §4).
 *
 * 열은 폭으로 정한다 — 1200 이상 5열, 990~1199 4열, 750~989 3열, 750 미만 2열. 숫자는 `wc-storefront-x.css`의
 * `.wc-x-grid`가 쥐고, 이 부품은 마크업(`ul` + density 속성)만 소유한다. 기존 `.wc-product-grid`(4열)는 이 부품을 쓰지
 * 않는 화면을 위해 그대로 둔다. 로딩 스켈레톤은 같은 클래스·density로 그려야 실제 목록과 같은 자리에서 바뀐다.
 */
export function ProductGrid({ children, className, density = 'listing', label }: ProductGridProps) {
  return (
    <ul aria-label={label} className={`wc-x-grid${className ? ` ${className}` : ''}`} data-density={density}>
      {children}
    </ul>
  );
}
