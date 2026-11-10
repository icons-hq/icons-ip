import { describe, expect, it } from 'vitest';
import { MEMBER_ACTIVITY_NOTICE_VERSION, parseMemberActivityEvent, parseMemberActivityIdentity, parseMemberActivityState } from './member-activity';
const actorId = 'a6160000-0000-4000-8000-000000000001', sessionId = 'a6160000-0000-4000-8000-000000000002';
describe('identified activity boundary', () => {
  it('does not accept arbitrary URL, referrer, or extra private data in events', () => {
    const event = { eventId: actorId, kind: 'visit', pageKind: 'good', targetId: 'test-good', assetId: null };
    expect(parseMemberActivityEvent(event)).toEqual(event);
    for (const patch of [{ url: 'https://private.test' }, { pageKind: 'account' }, { targetId: 'test-good?email=private' }, { kind: 'visit', assetId: sessionId }, { pageKind: 'home', kind: 'video_started', assetId: sessionId }]) expect(parseMemberActivityEvent({ ...event, ...patch })).toBeNull();
  });
  it('accepts only the separately versioned consent state and exact identity', () => {
    const state = { actorId, sessionId, revision: 0, enabled: false, choice: 'unset', noticeVersion: MEMBER_ACTIVITY_NOTICE_VERSION, acceptedAt: null };
    expect(parseMemberActivityState(state)).toEqual(state);
    for (const patch of [{ noticeVersion: 'analytics-v1' }, { choice: 'accepted' }, { revision: 1 }, { marketing: true }]) expect(parseMemberActivityState({ ...state, ...patch })).toBeNull();
    expect(parseMemberActivityIdentity({ actorId, sessionId, revision: 1, marketing: true })).toBeNull();
  });
});
