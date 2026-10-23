import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmWish,
  confirmedWish,
  forgetWishConfirmations,
  subscribeWishConfirmations,
} from './wishlist-heart-store';

beforeEach(() => forgetWishConfirmations());

describe('wishlist heart session store', () => {
  it('remembers only what the server confirmed, per good', () => {
    expect(confirmedWish('g1')).toBeUndefined();

    confirmWish('g1', true);
    confirmWish('g2', false);

    expect(confirmedWish('g1')).toBe(true);
    expect(confirmedWish('g2')).toBe(false);
  });

  it('notifies subscribers on real changes and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWishConfirmations(listener);

    confirmWish('g1', true);
    confirmWish('g1', true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    confirmWish('g1', false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets every confirmation at the login wall so the next visitor starts from server values', () => {
    const listener = vi.fn();
    subscribeWishConfirmations(listener);
    confirmWish('g1', true);
    listener.mockClear();

    forgetWishConfirmations();
    forgetWishConfirmations();

    expect(confirmedWish('g1')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
