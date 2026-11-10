import { describe, expect, it } from 'vitest';
import { loginEntryHref } from './login-entry';

describe('크롬 로그인 진입 주소', () => {
  it('일반 화면에서는 현재 경로와 쿼리를 복귀 경로로 넘긴다', () => {
    expect(loginEntryHref('/cart', '')).toBe('/login?next=%2Fcart');
    expect(loginEntryHref('/shop', '?sort=new&ip=a')).toBe(`/login?next=${encodeURIComponent('/shop?sort=new&ip=a')}`);
  });

  /* CH-13로 /login에도 전역 크롬이 선다 — 거기서 '로그인'을 다시 누르면 복귀 경로를 감싸지 않고 그대로 둔다. */
  it('로그인 화면에서는 가진 복귀 경로를 중첩 없이 유지하고 모드는 로그인으로 돌린다', () => {
    expect(loginEntryHref('/login', '?next=%2Fcart')).toBe('/login?next=%2Fcart');
    expect(loginEntryHref('/login', '?mode=signup&next=%2Fshop%3Fsort%3Dnew')).toBe(`/login?next=${encodeURIComponent('/shop?sort=new')}`);
    expect(loginEntryHref('/login', '?mode=reset')).toBe('/login');
    expect(loginEntryHref('/login', '')).toBe('/login');
    expect(loginEntryHref('/login', '?next=%2Fcart')).not.toContain(encodeURIComponent('/login'));
  });
});
