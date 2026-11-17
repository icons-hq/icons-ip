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
