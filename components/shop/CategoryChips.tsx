import Link from 'next/link';
import { ListingNav } from '@/components/shop/ListingNav';
import type { CategoryChip, CategoryListingNav } from '@/lib/category-chips';

/*
 * 카테고리 칩 영역 (스펙 C §2.4, D6·D7). 전시 분류 1단계 노드가 칩이고 앞 4개(+ '전체')가 1줄, 나머지가 구분선 아래 2줄이다.
 * 선택 칩은 검정 채움 알약 + `aria-current="page"`. 모바일(750 미만)은 두 줄을 한 줄 가로 스크롤로 합친다.
 * 칩 자체는 링크라 서버에서 그린다 — 가로 스크롤 보정만 `ListingNav`(클라이언트)가 맡는다.
 */
function ChipRow({ chips, tier }: { chips: readonly CategoryChip[]; tier: 'primary' | 'secondary' }) {
  return (
    <ul className="wc-listing-chips__row" data-tier={tier}>
      {chips.map((chip) => (
        <li key={chip.id}>
          <Link aria-current={chip.selected ? 'page' : undefined} className="wc-listing-chip" href={chip.href}>{chip.label}</Link>
        </li>
      ))}
    </ul>
  );
}

export function CategoryChips({ nav }: { nav: Pick<CategoryListingNav, 'firstRow' | 'secondRow'> }) {
  if (nav.firstRow.length === 0 && nav.secondRow.length === 0) return null;
  const selected = [...nav.firstRow, ...nav.secondRow].find((chip) => chip.selected);
  return (
    <ListingNav activeKey={selected?.id ?? ''} className="wc-listing-chips" label="카테고리">
      <div className="wc-listing-chips__scroller">
        <ChipRow chips={nav.firstRow} tier="primary" />
        {nav.secondRow.length > 0 ? (
          <>
            <div aria-hidden className="wc-listing-chips__rule" />
            <ChipRow chips={nav.secondRow} tier="secondary" />
          </>
        ) : null}
      </div>
    </ListingNav>
  );
}
