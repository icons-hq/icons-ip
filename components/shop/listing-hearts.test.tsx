import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductCard } from '@/components/wc/ProductCard';
import { listingHeartsFor } from './listing-hearts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

const card = (action: ReturnType<ReturnType<typeof listingHeartsFor>>) => renderToStaticMarkup(
  <ProductCard action={action} href="/shop/g1" name="아크릴 블록" price={12000} />,
);

describe('listingHeartsFor', () => {
  it('위시 ID 집합으로 굿즈별 초기 상태를 정한 L4 목록 하트를 카드 action 슬롯에 꽂는다', () => {
    const heartFor = listingHeartsFor({ viewerId: 'viewer-1', goodIds: ['g1'] });
    const wished = card(heartFor({ id: 'g1', name: '아크릴 블록' }));
    const other = card(heartFor({ id: 'g2', name: '오로라 키링' }));

    expect(wished).toContain('<div class="wc-product-card__action"><button');
    expect(wished).toContain('aria-pressed="true"');
    expect(wished).toContain('aria-label="아크릴 블록 위시리스트에서 빼기"');
    expect(other).toContain('aria-pressed="false"');
    expect(other).toContain('aria-label="오로라 키링 위시리스트에 담기"');
    /* 하트는 이미지 링크의 형제다 — 링크 안에 버튼이 들어가지 않는다. */
    expect(wished).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
  });

  it('게스트도 하트를 보고(누르면 로그인 벽) 위시 상태를 받지 않은 자리는 하트를 그리지 않는다', () => {
    expect(card(listingHeartsFor({ viewerId: null, goodIds: [] })({ id: 'g1', name: '아크릴 블록' }))).toContain('aria-pressed="false"');
    expect(listingHeartsFor(null)({ id: 'g1', name: '아크릴 블록' })).toBeUndefined();
    expect(listingHeartsFor(undefined)({ id: 'g1', name: '아크릴 블록' })).toBeUndefined();
    expect(card(undefined)).not.toContain('wc-list-heart');
  });
});
