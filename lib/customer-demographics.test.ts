import { describe, expect, it } from 'vitest';
import { DEMOGRAPHIC_NOTICE_VERSION, parseDemographicIdentity, parseDemographicState } from './customer-demographics';
const identity = { actorId: 'a6191000-0000-4000-8000-000000000001', sessionId: 'a6191000-0000-4000-9000-000000000001', revision: 0 };
const unset = { ...identity, choice: 'unset', gender: null, noticeVersion: DEMOGRAPHIC_NOTICE_VERSION, acceptedAt: null };
describe('optional demographic choice contract', () => {
  it('keeps absent gender distinct from a choice', () => expect(parseDemographicState(unset)).toEqual(unset));
  it('requires explicit gender and acceptance timestamp', () => {
    expect(parseDemographicState({ ...unset, choice: 'accepted', gender: 'female', revision: 1, acceptedAt: '2026-10-19T01:00:00Z' })).not.toBeNull();
    expect(parseDemographicState({ ...unset, choice: 'accepted', revision: 1 })).toBeNull();
  });
  it.each([{ gender: 'male' }, { revision: 1 }, { noticeVersion: 'old' }, { choice: 'unknown' }, { rawGender: 'female' }])('rejects invalid or extra state %j', patch => expect(parseDemographicState({ ...unset, ...patch })).toBeNull());
  it('requires erased gender on withdrawal', () => {
    expect(parseDemographicState({ ...unset, choice: 'declined', revision: 2 })).not.toBeNull();
    expect(parseDemographicState({ ...unset, choice: 'declined', revision: 2, gender: 'female' })).toBeNull();
  });
  it('rejects an unbound or extra identity', () => {
    expect(parseDemographicIdentity(identity)).toEqual(identity);
    expect(parseDemographicIdentity({ ...identity, userId: identity.actorId })).toBeNull();
    expect(parseDemographicIdentity({ ...identity, sessionId: '' })).toBeNull();
  });
});
