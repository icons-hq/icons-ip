import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  KAKAO_JWKS_URL,
  KAKAO_SET_ISSUER,
  KAKAO_USER_UNLINKED_EVENT,
  createKakaoJwksStore,
  handleKakaoAccountStatusWebhook,
  kakaoAccountStatusConfig,
  readKakaoUnlinkEvent,
  type KakaoAccountStatusConfig,
  type KakaoJwksStore,
} from './account-unlink.server';

/* 카카오 계정 상태 변경 웹훅(SSF) — 서명·발급자·대상 검증, 연결 해제 이벤트 읽기, DB 기록 실패 시 재전송. */

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('tests inject the service client');
  },
}));

const REST_API_KEY = '0123456789abcdef0123456789abcdef';
const CONFIG: KakaoAccountStatusConfig = { restApiKey: REST_API_KEY };
const KID = 'kakao-test-key';
const KAKAO_ID = '1234567890';
const TOE = 1_763_450_000;

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherSigning = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwk(publicKey: KeyObject, kid: string) {
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

function jwksFetch(keys: unknown[] = [jwk(signing.publicKey, KID)], status = 200) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    void init;
    expect(input).toBe(KAKAO_JWKS_URL);
    return new Response(JSON.stringify({ keys }), { status });
  });
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(options: {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  key?: KeyObject;
} = {}) {
  const header = { alg: 'RS256', typ: 'secevent+jwt', kid: KID, ...options.header };
  const payload = {
    iss: KAKAO_SET_ISSUER,
    aud: REST_API_KEY,
    sub: KAKAO_ID,
    iat: TOE + 5,
    toe: TOE,
    jti: 'set-jti-1',
    txm: 'txm-1',
    app_id: '1520482',
    events: {
      [KAKAO_USER_UNLINKED_EVENT]: {
        subject: { subject_type: 'iss-sub', iss: KAKAO_SET_ISSUER, sub: KAKAO_ID },
        reason: 'UNLINK_FROM_APPS',
      },
    },
    ...options.payload,
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), options.key ?? signing.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function service(response: { data: unknown; error: unknown } = { data: { status: 'identity_unlinked', replayed: false }, error: null }) {
  const abortSignal = vi.fn(async () => response);
  const rpc = vi.fn(() => ({ abortSignal }));
  return { rpc, abortSignal, client: { rpc } as never };
}

function store(fetchMock = jwksFetch()): KakaoJwksStore {
  return createKakaoJwksStore({ fetch: fetchMock });
}

describe('kakaoAccountStatusConfig', () => {
  it('needs a well-formed REST API key, otherwise the webhook stays closed', () => {
    expect(kakaoAccountStatusConfig({})).toBeNull();
    expect(kakaoAccountStatusConfig({ KAKAO_REST_API_KEY: 'short' })).toBeNull();
    expect(kakaoAccountStatusConfig({ KAKAO_REST_API_KEY: `${REST_API_KEY}!` })).toBeNull();
    expect(kakaoAccountStatusConfig({ KAKAO_REST_API_KEY: ` ${REST_API_KEY} ` })).toEqual(CONFIG);
  });
});

describe('handleKakaoAccountStatusWebhook', () => {
  it('answers 404 without touching Kakao or the DB while unconfigured', async () => {
    const fetchMock = jwksFetch();
    const db = service();

    expect(await handleKakaoAccountStatusWebhook({ body: token() }, { config: null, jwks: store(fetchMock), service: db.client }))
      .toEqual({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('records a verified unlink before answering 202', async () => {
    const db = service();

    const result = await handleKakaoAccountStatusWebhook({ body: token() }, { config: CONFIG, jwks: store(), service: db.client });

    expect(result).toEqual({ status: 202 });
    expect(db.rpc).toHaveBeenCalledWith('service_record_kakao_unlink', {
      p_event_id: 'set-jti-1',
      p_kakao_user_id: KAKAO_ID,
      p_reason: 'UNLINK_FROM_APPS',
      p_event_at: new Date(TOE * 1000).toISOString(),
    });
    expect(db.abortSignal).toHaveBeenCalledOnce();
  });

  it.each(['withdrawal_review', 'relinked', 'no_member'])('accepts the %s outcome', async (status) => {
    const db = service({ data: { status, replayed: true }, error: null });
    expect(await handleKakaoAccountStatusWebhook({ body: token() }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 202 });
  });

  it('answers 500 so Kakao retries when the DB fails or answers oddly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const response of [
      { data: null, error: { message: 'timeout' } },
      { data: { status: 'granted' }, error: null },
      { data: null, error: null },
    ]) {
      const db = service(response);
      expect(await handleKakaoAccountStatusWebhook({ body: token() }, { config: CONFIG, jwks: store(), service: db.client }))
        .toEqual({ status: 500 });
    }
    /* 로그에 카카오 회원번호를 남기지 않는다. */
    expect(JSON.stringify(error.mock.calls)).not.toContain(KAKAO_ID);
    error.mockRestore();
  });

  it('answers 500 when the signing key cannot be found, so a rotated key does not lose the event', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = service();
    const down = vi.fn(async () => new Response('busy', { status: 503 }));

    expect(await handleKakaoAccountStatusWebhook({ body: token() }, { config: CONFIG, jwks: store(down), service: db.client }))
      .toEqual({ status: 500 });
    expect(await handleKakaoAccountStatusWebhook({ body: token({ header: { kid: 'rotated' } }) }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 500 });
    expect(db.rpc).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    ['no jti', { jti: undefined }, {}],
    ['a string toe', { toe: '1763450000' }, {}],
    ['a lower-case reason', {}, { reason: 'unlink_from_apps' }],
    ['a subject that disagrees with sub', {}, { subject: { sub: '999' } }],
  ])('answers 500 and logs when a signed SET has %s (Kakao retries; we can hotfix)', async (_label, payload, event) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = service();
    const body = token({
      payload: {
        ...payload,
        ...(Object.keys(event).length ? { events: { [KAKAO_USER_UNLINKED_EVENT]: { reason: 'UNLINK_FROM_APPS', ...event } } } : {}),
      },
    });

    expect(await handleKakaoAccountStatusWebhook({ body }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 500 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain(KAKAO_ID);
    error.mockRestore();
  });

  it.each([
    ['not a JWT', 'abc', 'invalid_request'],
    ['alg none', token({ header: { alg: 'none' } }), 'invalid_request'],
    ['HS256', token({ header: { alg: 'HS256' } }), 'invalid_request'],
    ['wrong typ', token({ header: { typ: 'JWT' } }), 'invalid_request'],
    ['missing kid', token({ header: { kid: '' } }), 'invalid_request'],
    ['wrong issuer', token({ payload: { iss: 'https://kauth.example.com' } }), 'invalid_issuer'],
    ['another app', token({ payload: { aud: 'fedcba9876543210fedcba9876543210' } }), 'invalid_audience'],
    ['another signer', token({ key: otherSigning.privateKey }), 'invalid_key'],
  ])('refuses %s with an RFC 8935 error and logs why', async (_label, body, err) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = service();

    const result = await handleKakaoAccountStatusWebhook({ body }, { config: CONFIG, jwks: store(), service: db.client });

    expect(result).toMatchObject({ status: 400, body: { err } });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[kakao-account-status] refused', expect.objectContaining({ err }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KAKAO_ID);
    warn.mockRestore();
  });

  it('accepts the media-type spelling of typ', async () => {
    const db = service();
    expect(await handleKakaoAccountStatusWebhook({ body: token({ header: { typ: 'application/secevent+jwt' } }) }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 202 });
  });

  it('refuses a tampered payload even with a valid header and signature from the real key', async () => {
    const [header, , signature] = token().split('.');
    const forged = `${header}.${encode({ iss: KAKAO_SET_ISSUER, aud: REST_API_KEY, sub: '999', toe: TOE, jti: 'x', events: {} })}.${signature}`;
    const db = service();

    expect(await handleKakaoAccountStatusWebhook({ body: forged }, { config: CONFIG, jwks: store(), service: db.client }))
      .toMatchObject({ status: 400, body: { err: 'invalid_key' } });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('accepts other events without touching the DB', async () => {
    const db = service();
    const body = token({
      payload: { events: { 'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked': { subject: { sub: KAKAO_ID } } } },
    });

    expect(await handleKakaoAccountStatusWebhook({ body }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 202 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('accepts an audience array and a numeric member number', async () => {
    const db = service();
    const body = token({
      payload: {
        aud: ['other', REST_API_KEY],
        sub: Number(KAKAO_ID),
        events: { [KAKAO_USER_UNLINKED_EVENT]: { reason: 'ACCOUNT_DELETE' } },
      },
    });

    expect(await handleKakaoAccountStatusWebhook({ body }, { config: CONFIG, jwks: store(), service: db.client }))
      .toEqual({ status: 202 });
    expect(db.rpc).toHaveBeenCalledWith('service_record_kakao_unlink', expect.objectContaining({
      p_kakao_user_id: KAKAO_ID,
      p_reason: 'ACCOUNT_DELETE',
    }));
  });
});

describe('readKakaoUnlinkEvent', () => {
  const base = { jti: 'j', occurredAt: TOE, sub: KAKAO_ID };

  it('reads the member number from the event subject and the top-level sub', () => {
    expect(readKakaoUnlinkEvent({ ...base, events: { [KAKAO_USER_UNLINKED_EVENT]: { reason: 'UNLINK_FROM_ADMIN', subject: { sub: KAKAO_ID } } } }))
      .toEqual({ eventId: 'j', kakaoUserId: KAKAO_ID, reason: 'UNLINK_FROM_ADMIN', occurredAt: new Date(TOE * 1000) });
    expect(readKakaoUnlinkEvent({ ...base, sub: null, events: { [KAKAO_USER_UNLINKED_EVENT]: { reason: 'UNLINK_FROM_ADMIN', subject: { sub: KAKAO_ID } } } }))
      .toMatchObject({ kakaoUserId: KAKAO_ID });
  });

  it('is null for SETs without a user-unlinked event', () => {
    expect(readKakaoUnlinkEvent({ ...base, events: {} })).toBeNull();
  });

  it.each([
    ['subject and sub disagree', { reason: 'ACCOUNT_DELETE', subject: { sub: '999' } }, KAKAO_ID],
    ['no member number anywhere', { reason: 'ACCOUNT_DELETE' }, null],
    ['an email subject', { reason: 'ACCOUNT_DELETE', subject: { subject_type: 'account_email' } }, KAKAO_ID],
    ['another issuer in the subject', { reason: 'ACCOUNT_DELETE', subject: { iss: 'https://example.com', sub: KAKAO_ID } }, KAKAO_ID],
    ['a lower-case reason', { reason: 'account_delete' }, KAKAO_ID],
    ['a malformed member number', { reason: 'ACCOUNT_DELETE', subject: { sub: '01234' } }, KAKAO_ID],
  ])('rejects %s', (_label, event, sub) => {
    expect(readKakaoUnlinkEvent({ ...base, sub, events: { [KAKAO_USER_UNLINKED_EVENT]: event } })).toHaveProperty('error');
  });
});

describe('createKakaoJwksStore', () => {
  it('caches the key list and refetches an unknown kid at most once a minute', async () => {
    let now = 1_000_000;
    const fetchMock = jwksFetch();
    const jwks = createKakaoJwksStore({ fetch: fetchMock, now: () => now });

    expect(await jwks.getKey(KID)).toBeInstanceOf(Object);
    expect(await jwks.getKey(KID)).toBeInstanceOf(Object);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    /* 모르는 kid는 1분 안에는 다시 받지 않고, 찾지 못하면 재전송(500)을 부른다. */
    expect(await jwks.getKey('rotated')).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 61_000;
    expect(await jwks.getKey('rotated')).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between requests that arrive before the first key list', async () => {
    let release: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve;
    }));
    const jwks = createKakaoJwksStore({ fetch: fetchMock });

    const first = jwks.getKey(KID);
    const second = jwks.getKey(KID);
    release(new Response(JSON.stringify({ keys: [jwk(signing.publicKey, KID)] })));

    expect(await first).toBeInstanceOf(Object);
    expect(await second).toBeInstanceOf(Object);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('picks up a rotated key and keeps serving the old list when a refresh fails', async () => {
    let now = 1_000_000;
    let keys: unknown[] = [jwk(signing.publicKey, KID)];
    let fail = false;
    const fetchMock = vi.fn(async () => (fail ? new Response('down', { status: 500 }) : new Response(JSON.stringify({ keys }))));
    const jwks = createKakaoJwksStore({ fetch: fetchMock, now: () => now });

    expect(await jwks.getKey(KID)).not.toBeNull();
    keys = [jwk(signing.publicKey, KID), jwk(otherSigning.publicKey, 'rotated')];
    now += 61_000;
    expect(await jwks.getKey('rotated')).not.toBeNull();

    fail = true;
    now += 7 * 60 * 60 * 1000;
    expect(await jwks.getKey(KID)).not.toBeNull();
  });

  it('ignores keys that are not RS256 signing keys', async () => {
    let now = 1_000_000;
    const jwks = createKakaoJwksStore({
      fetch: jwksFetch([
        { ...jwk(signing.publicKey, 'enc'), use: 'enc' },
        { ...jwk(signing.publicKey, 'es'), alg: 'ES256' },
        { kty: 'EC', kid: 'ec', crv: 'P-256', x: 'a', y: 'b' },
        jwk(signing.publicKey, KID),
      ]),
      now: () => now,
    });

    for (const kid of ['enc', 'es', 'ec']) {
      expect(await jwks.getKey(kid)).toBe('unavailable');
      now += 61_000;
    }
    expect(await jwks.getKey(KID)).toBeInstanceOf(Object);
  });

  it('is unavailable when the first fetch fails or returns no usable keys', async () => {
    expect(await createKakaoJwksStore({ fetch: jwksFetch([], 200) }).getKey(KID)).toBe('unavailable');
    expect(await createKakaoJwksStore({ fetch: vi.fn(async () => { throw new Error('offline'); }) }).getKey(KID)).toBe('unavailable');
  });
});
