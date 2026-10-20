import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailReviewLink } from './ProductDetailReviewLink';

function setup(search = '?reviewPage=1') {
  const location = { href: `https://icons.test/shop/g1${search}`, pathname: '/shop/g1', search, hash: '', reload: vi.fn() };
  vi.stubGlobal('window', { location });
  const preventDefault = vi.fn();
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault } as unknown as MouseEvent<HTMLAnchorElement>;
  const link = ProductDetailReviewLink({ href: '/shop/g1?reviewPage=1#reviews', children: '리뷰 모두 보기' });
  return { location, event, preventDefault, link };
}

afterEach(() => vi.unstubAllGlobals());

describe('product detail review navigation', () => {
  it('reloads an unchanged review URL so a manually selected detail tab cannot hide the destination', () => {
    const { location, event, preventDefault, link } = setup();
    link.props.onClick(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(location.hash).toBe('#reviews');
    expect(location.reload).toHaveBeenCalledOnce();
  });
  it('keeps native document navigation when the review URL changes', () => {
    const { location, event, preventDefault, link } = setup('');
    link.props.onClick(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
  it('preserves opening a review in another tab with a modifier', () => {
    const { location, event, preventDefault, link } = setup();
    link.props.onClick({ ...event, metaKey: true });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
});
