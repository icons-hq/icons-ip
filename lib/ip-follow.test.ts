import { describe, expect, it } from 'vitest';
import type { IpFollowState } from './ip-follow';
import { buildRecommendedIpFollowChanges, normalizeIpFollowIntent, uniqueSelectedIpIds } from './ip-follow';

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

describe('uniqueSelectedIpIds', () => {
  it('deduplicates selected recommendation IDs in order', () => {
    expect(uniqueSelectedIpIds(['hwasan', 'lumen', 'hwasan'])).toEqual(['hwasan', 'lumen']);
  });

  it('keeps only allowed IP IDs and caps the selection', () => {
    const allowed = new Set(['hwasan', 'lumen', 'hoshina', 'aster']);

    expect(uniqueSelectedIpIds(['hwasan', 'unknown', 'lumen', 'hoshina', 'aster'], allowed, 3)).toEqual([
      'hwasan',
      'lumen',
      'hoshina',
    ]);
  });
});

describe('buildRecommendedIpFollowChanges', () => {
  it('follows each selected recommended IP once and ignores values outside the recommendation set', () => {
    expect(
      buildRecommendedIpFollowChanges({
        followedIpIds: [],
        recommendedIpIds: ['hwasan', 'lumen', 'hoshina'],
        selectedIpIds: ['hwasan', 'unknown', 'hwasan', 'lumen'],
      }),
    ).toEqual({
      toFollow: ['hwasan', 'lumen'],
      toUnfollow: [],
    });
  });

  it('unfollows a previously followed recommended IP when it is unchecked', () => {
    expect(
      buildRecommendedIpFollowChanges({
        followedIpIds: ['hwasan', 'lumen', 'aster'],
        recommendedIpIds: ['hwasan', 'lumen', 'hoshina'],
        selectedIpIds: ['lumen'],
      }),
    ).toEqual({
      toFollow: [],
      toUnfollow: ['hwasan'],
    });
  });

  it('does not change already-followed selected recommendations', () => {
    expect(
      buildRecommendedIpFollowChanges({
        followedIpIds: ['hwasan'],
        recommendedIpIds: ['hwasan', 'lumen'],
        selectedIpIds: ['hwasan'],
      }),
    ).toEqual({
      toFollow: [],
      toUnfollow: [],
    });
  });
});
