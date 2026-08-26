import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_RUN_COOKIE,
  createLastBellGuestRunToken,
  digestLastBellGuestRunToken,
  getLastBellGuestRunToken,
  lastBellGuestCookieDeleteOptions,
  lastBellGuestCookieOptions,
  parseLastBellRpcError,
  parseLastBellRunStartInput,
  parseLastBellRuntimeEventInput,
} from './contract';

describe('Last Bell verified-run wire contract', () => {
  it('accepts only the canonical event discriminators and never a client good id', () => {
    const input = {
      sequence: 7,
      operationId: '00000000-0000-4000-8000-000000000007',
      type: 'pickup',
      chapterId: 'chapter-01',
      zoneId: 'classroom',
      collectibleKey: 'idcard',
      objectiveId: null,
      checkpointId: null,
    };

    expect(parseLastBellRuntimeEventInput(input)).toEqual(input);
    expect(parseLastBellRuntimeEventInput({ ...input, type: 'chapter complete' })).toBeNull();
    expect(parseLastBellRuntimeEventInput({ ...input, goodId: 'client-controlled-good' })).toBeNull();
  });

  it('accepts runtime milestone identifiers, including dotted objective ids', () => {
    expect(parseLastBellRuntimeEventInput({
      sequence: 1,
      operationId: '00000000-0000-4000-8000-000000000001',
      type: 'objective',
      chapterId: 'chapter-01',
      zoneId: 'classroom',
      objectiveId: 'ch1.open-classroom-door',
      collectibleKey: null,
      checkpointId: null,
    })).toMatchObject({ objectiveId: 'ch1.open-classroom-door' });
  });

  it('defaults to Chapter 1 and allows an explicit independent Chapter 2 start', () => {
    expect(parseLastBellRunStartInput({})).toEqual({ startChapterId: 'chapter-01', runMode: 'first-play' });
    expect(parseLastBellRunStartInput({ startChapterId: 'chapter-02', runMode: 'chapter-replay' })).toEqual({ startChapterId: 'chapter-02', runMode: 'chapter-replay' });
    expect(parseLastBellRunStartInput({ startChapterId: 'chapter-02' })).toBeNull();
    expect(parseLastBellRunStartInput({ startChapterId: 'chapter-01', runMode: 'chapter-replay' })).toEqual({ startChapterId: 'chapter-01', runMode: 'chapter-replay' });
    expect(parseLastBellRunStartInput({ startChapterId: 'chapter-03' })).toBeNull();
  });

  it('uses an opaque token cookie but exposes only a SHA-256 digest to the DB caller', () => {
    const rawToken = createLastBellGuestRunToken();
    const digest = digestLastBellGuestRunToken(rawToken);

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(rawToken);
    expect(getLastBellGuestRunToken(`other=value; ${LAST_BELL_RUN_COOKIE}=${rawToken}`)).toBe(rawToken);
    expect(getLastBellGuestRunToken(`${LAST_BELL_RUN_COOKIE}=not-a-token`)).toBe('not-a-token');
    expect(digestLastBellGuestRunToken('not-a-token')).toBeNull();
  });

  it('expires the __Host- guest cookie with the same secure host-only attributes', () => {
    expect(lastBellGuestCookieDeleteOptions).toEqual({
      ...lastBellGuestCookieOptions,
      maxAge: 0,
    });
    expect(lastBellGuestCookieDeleteOptions).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });

  it('maps account write fences without leaking a database error', () => {
    expect(parseLastBellRpcError('account_suspended')).toEqual({ status: 403, code: 'account_suspended' });
    expect(parseLastBellRpcError('account_deletion_write_fenced')).toEqual({
      status: 409,
      code: 'account_deletion_write_fenced',
    });
    expect(parseLastBellRpcError('onboarding_required')).toEqual({ status: 409, code: 'onboarding_required' });
  });
});
