import { describe, expect, it } from 'vitest';
import type { IpFollowState } from './ip-follow';
import { normalizeIpFollowIntent } from './ip-follow';

describe('IpFollowState', () => {
  it('carries both in-app notification channel preferences', () => {
    const state: IpFollowState = {
      isFollowed: true,
      notifyDrops: false,
      notifyEvents: true,
    };

    expect(state).toEqual({
      isFollowed: true,
      notifyDrops: false,
      notifyEvents: true,
    });
  });
});

describe('normalizeIpFollowIntent', () => {
  it('defaults to follow unless the form explicitly asks to unfollow', () => {
    expect(normalizeIpFollowIntent(null)).toBe('follow');
    expect(normalizeIpFollowIntent('follow')).toBe('follow');
    expect(normalizeIpFollowIntent('unfollow')).toBe('unfollow');
  });
});
