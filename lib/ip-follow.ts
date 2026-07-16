export const MAX_ONBOARDING_FOLLOW_SELECTIONS = 5;

export type IpFollowIntent = 'follow' | 'unfollow';

export interface IpFollowState {
  isFollowed: boolean;
  notifyDrops: boolean;
  notifyEvents: boolean;
}

export interface IpNotificationPreference {
  ipId: string;
  notifyDrops: boolean;
  notifyEvents: boolean;
}

export function normalizeIpFollowIntent(value: FormDataEntryValue | string | null | undefined): IpFollowIntent {
  return value === 'unfollow' ? 'unfollow' : 'follow';
}

export function uniqueSelectedIpIds(
  values: FormDataEntryValue[],
  allowedIds?: ReadonlySet<string>,
  limit: number = MAX_ONBOARDING_FOLLOW_SELECTIONS,
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;

    const id = value.trim();
    if (!id || seen.has(id)) continue;
    if (allowedIds && !allowedIds.has(id)) continue;

    seen.add(id);
    selected.push(id);
    if (selected.length >= limit) break;
  }

  return selected;
}

export interface RecommendedIpFollowChangeInput {
  followedIpIds: string[];
  recommendedIpIds: string[];
  selectedIpIds: string[];
}

export interface RecommendedIpFollowChanges {
  toFollow: string[];
  toUnfollow: string[];
}

export function buildRecommendedIpFollowChanges({
  followedIpIds,
  recommendedIpIds,
  selectedIpIds,
}: RecommendedIpFollowChangeInput): RecommendedIpFollowChanges {
  const recommended = new Set(uniqueSelectedIpIds(recommendedIpIds));
  const followed = new Set(uniqueSelectedIpIds(followedIpIds, recommended));
  const selected = new Set(uniqueSelectedIpIds(selectedIpIds, recommended));

  return {
    toFollow: [...selected].filter((ipId) => !followed.has(ipId)),
    toUnfollow: [...followed].filter((ipId) => !selected.has(ipId)),
  };
}
