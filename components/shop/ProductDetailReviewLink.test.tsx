import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailReviewLink } from './ProductDetailReviewLink';

function setup(search = '?reviewPage=1') {
  const history = { scrollRestoration: 'auto' as ScrollRestoration };
  const reloaded: { scrollRestoration: ScrollRestoration | null } = { scrollRestoration: null };
  const location = {
    href: `https://icons.test/shop/g1${search}`, pathname: '/shop/g1', search, hash: '',
    reload: vi.fn(() => { reloaded.scrollRestoration = history.scrollRestoration; }),
  };
  vi.stubGlobal('window', { location, history });
  const preventDefault = vi.fn();
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault } as unknown as MouseEvent<HTMLAnchorElement>;
  const link = ProductDetailReviewLink({ href: '/shop/g1?reviewPage=1#reviews', children: '리뷰 모두 보기' });
  return { location, history, reloaded, event, preventDefault, link };
}

afterEach(() => vi.unstubAllGlobals());

describe('product detail review navigation', () => {
  it('reloads an unchanged review URL so a manually selected detail tab cannot hide the destination', () => {
    const { location, reloaded, event, preventDefault, link } = setup();
    link.props.onClick(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(location.hash).toBe('#reviews');
    expect(location.reload).toHaveBeenCalledOnce();
    /* 새로고침은 읽던 자리를 복원해 리뷰로 내려가지 않는다(2026-10-23 실측: 클릭한 자리 근처에 머묾).
       복원을 끄고 다시 열어야 HashLanding 이 #reviews 에 세운다(shouldLandOnLoad). */
    expect(reloaded.scrollRestoration).toBe('manual');
  });
  it('keeps native document navigation when the review URL changes', () => {
    const { location, history, event, preventDefault, link } = setup('');
    link.props.onClick(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe('auto');
  });
  it('preserves opening a review in another tab with a modifier', () => {
    const { location, history, event, preventDefault, link } = setup();
    link.props.onClick({ ...event, metaKey: true });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe('auto');
  });
});
