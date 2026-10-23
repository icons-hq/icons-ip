import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductCard } from '@/components/wc/ProductCard';
import { listingHeartsFor, wishlistForOwner } from './listing-hearts';

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

/* l4b-data-1 — 스스로 계정 전환을 따라가는 선반은 그리는 목록의 주인과 서버가 판정한 회원이 같을 때만 하트를 단다. */
describe('wishlistForOwner', () => {
  const member = { viewerId: 'viewer-a', goodIds: ['g1'] };
  const guest = { viewerId: null, goodIds: [] };

  it('목록의 주인이 서버가 판정한 회원과 같으면(게스트끼리 포함) 그 위시 상태를 그대로 넘긴다', () => {
    expect(wishlistForOwner(member, 'viewer-a')).toBe(member);
    expect(wishlistForOwner(guest, null)).toBe(guest);
  });

  it('다른 회원·게스트↔회원 전환·주인 미정이면 하트를 그리지 않도록 null 이다', () => {
    expect(wishlistForOwner(member, 'viewer-b')).toBeNull();
    /* 서버는 회원으로 그렸는데 선반은 로그아웃을 관측했다 — 게스트 목록에 이전 회원의 찜이 보이면 안 된다. */
    expect(wishlistForOwner(member, null)).toBeNull();
    /* 서버는 게스트로 그렸는데 선반은 회원을 관측했다 — 회원 화면에 로그인 벽 하트가 서면 안 된다. */
    expect(wishlistForOwner(guest, 'viewer-b')).toBeNull();
    expect(wishlistForOwner(member, undefined)).toBeNull();
    expect(wishlistForOwner(null, 'viewer-a')).toBeNull();
    expect(wishlistForOwner(undefined, null)).toBeNull();
    expect(listingHeartsFor(wishlistForOwner(member, 'viewer-b'))({ id: 'g1', name: '아크릴 블록' })).toBeUndefined();
  });
});
