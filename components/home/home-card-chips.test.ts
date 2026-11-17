import { describe, expect, it } from 'vitest';
import type { ProductCardChip } from '@/lib/product-card-chips';
import { homeCardChips } from './home-card-chips';

const chips: ProductCardChip[] = [
  { kind: 'preorder', label: '예약판매' }, { kind: 'freeShipping', label: '무료배송' }, { kind: 'tag', label: 'NEW' },
];
const server = { chips, badge: 'NEW' };

describe('homeCardChips', () => {
  it('passes the server chips through in order', () => {
    expect(homeCardChips(server, true).map((chip) => chip.label)).toEqual(['예약판매', '무료배송', 'NEW']);
  });

  /* 서버 칩에는 운영 배지('tag')가 항상 들어 있다 — 표시 설정이 태그를 끄면 그 칩만 빠지고 판매 상태 칩은 남는다. */
  it('removes only the tag chips when the store presentation hides tags', () => {
    expect(homeCardChips(server, false).map((chip) => chip.label)).toEqual(['예약판매', '무료배송']);
  });

  it('turns a stored badge into a tag chip for cards that carry no chips, and into nothing without one', () => {
    expect(homeCardChips({ badge: 'EXCLUSIVE' }, true)).toEqual([{ kind: 'tag', label: 'EXCLUSIVE' }]);
    expect(homeCardChips({ badge: 'EXCLUSIVE' }, false)).toEqual([]);
    expect(homeCardChips({ badge: null }, true)).toEqual([]);
  });

  it('keeps an explicitly empty chip list empty instead of reviving the badge', () => {
    expect(homeCardChips({ chips: [], badge: 'NEW' }, true)).toEqual([]);
  });
});
