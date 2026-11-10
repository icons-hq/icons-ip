import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ADULT_VERIFICATION_POLICY_VERSION } from '@/lib/age/adult-age';
import {
  AdultVerificationAccountBlockedError,
  AdultVerificationCompletionError,
  AdultVerificationRateLimitedError,
  AdultVerificationUnavailableError,
  adultVerificationReturnPath,
  adultVerificationTicketValue,
  beginAdultVerification,
  completeAdultVerification,
  parseAdultVerificationTicket,
  processKcpCertReturn,
  type AdultVerificationDependencies,
} from './adult-verification.server';
import { KcpCertRequestError } from './kcp-cert-client.server';
import type { KcpCertConfiguration } from './kcp-cert-config';

const NONCE = 'n'.repeat(43);
const NONCE_DIGEST = createHash('sha256').update(NONCE).digest('hex');
const COMPLETION_TOKEN = 't'.repeat(43);
const COMPLETION_TOKEN_DIGEST = createHash('sha256').update(COMPLETION_TOKEN).digest('hex');
const TICKET = { nonce: NONCE, token: COMPLETION_TOKEN };
const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const CLAIM_TOKEN = '20000000-0000-4000-8000-000000000002';
const PROVIDER_ORDER_ID = `IV${'a'.repeat(32)}`;

const config: KcpCertConfiguration = {
  mode: 'test',
  siteCode: 'T0001',
  encKey: 'unit-test-enc-key-0123456789abcdef',
  webSiteId: null,
  registrationUrl: 'https://testcert.kcp.co.kr/api/reg/certDataReg.do',
  resultUrl: 'https://testcert.kcp.co.kr/api/query/getCertData.do',
  certWindowOrigin: 'https://testcert.kcp.co.kr',
  siteOrigin: 'https://example.test',
  digestSecret: 'unit-test-digest-secret-0123456789abcdef',
};

type RpcCall = { fn: string; args: Record<string, unknown> };

function dependencies(overrides: Partial<AdultVerificationDependencies> = {}, rpcResults: Record<string, unknown> = {}) {
  const calls: RpcCall[] = [];
  const deps: AdultVerificationDependencies = {
    configuration: () => config,
    rpc: async <T,>(fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const result = rpcResults[fn];
      if (result instanceof Error) return { data: null as T | null, error: { message: result.message } };
      return { data: (result ?? null) as T | null, error: null };
    },
    register: vi.fn(async () => ({ callUrl: 'https://testcert.kcp.co.kr/certGateway.do', registrationKey: '1234567890123456' })),
    fetchResult: vi.fn(async () => ({ birthDay: '19900101', duplicateInfo: 'di-value', transactionNo: '25284339349648' })),
    now: () => new Date('2026-10-23T03:00:00Z'),
    nonce: () => NONCE,
    claimToken: () => CLAIM_TOKEN,
    completionToken: () => COMPLETION_TOKEN,
    ...overrides,
  };
  return { deps, calls };
}

describe('adultVerificationReturnPath', () => {
  it('같은 사이트 화면 경로만 남긴다', () => {
    expect(adultVerificationReturnPath('/shop/adult-good?option=1')).toBe('/shop/adult-good?option=1');
    expect(adultVerificationReturnPath('https://evil.test/')).toBe('/');
    expect(adultVerificationReturnPath('//evil.test')).toBe('/');
    expect(adultVerificationReturnPath('/api/identity/kcp/return/x')).toBe('/my');
    expect(adultVerificationReturnPath('/auth/callback')).toBe('/my');
    expect(adultVerificationReturnPath(`/${'a'.repeat(600)}`)).toBe('/my');
    expect(adultVerificationReturnPath(null)).toBe('/');
  });
});

describe('beginAdultVerification', () => {
  it('세션을 열고 KCP 거래등록을 마친 뒤 거래등록키를 세션에 붙인다', async () => {
    const { deps, calls } = dependencies({}, {
      begin_adult_verification: { sessionId: SESSION_ID, providerOrderId: PROVIDER_ORDER_ID },
    });

    const started = await beginAdultVerification({ userId: 'user-1', presentation: 'popup', returnPath: '/shop/g1' }, deps);

    expect(started).toEqual({
      callUrl: 'https://testcert.kcp.co.kr/certGateway.do',
      registrationKey: '1234567890123456',
      pageSubmit: 'N',
    });
    expect(calls[0]).toEqual({
      fn: 'begin_adult_verification',
      args: {
        p_user_id: 'user-1',
        p_provider_mode: 'test',
        p_presentation: 'popup',
        p_return_path: '/shop/g1',
        p_callback_nonce_digest: NONCE_DIGEST,
      },
    });
    expect(deps.register).toHaveBeenCalledWith(config, {
      providerOrderId: PROVIDER_ORDER_ID,
      returnUrl: `https://example.test/api/identity/kcp/return/${NONCE}`,
    });
    expect(calls[1]).toEqual({
      fn: 'register_adult_verification',
      args: { p_session_id: SESSION_ID, p_registration_key: '1234567890123456' },
    });
  });

  it('페이지 전환은 kcp_page_submit_yn=Y다', async () => {
    const { deps } = dependencies({}, { begin_adult_verification: { sessionId: SESSION_ID, providerOrderId: PROVIDER_ORDER_ID } });
    await expect(beginAdultVerification({ userId: 'user-1', presentation: 'page', returnPath: '/my' }, deps))
      .resolves.toMatchObject({ pageSubmit: 'Y' });
  });

  it('설정이 없으면 DB를 건드리지 않고 닫는다', async () => {
    const { deps, calls } = dependencies({ configuration: () => null });
    await expect(beginAdultVerification({ userId: 'user-1', presentation: 'page', returnPath: '/my' }, deps))
      .rejects.toBeInstanceOf(AdultVerificationUnavailableError);
    expect(calls).toEqual([]);
  });

  it('한도·정지는 각각의 오류로 돌려준다', async () => {
    await expect(beginAdultVerification({ userId: 'u', presentation: 'page', returnPath: '/my' },
      dependencies({}, { begin_adult_verification: new Error('adult_verification_rate_limited') }).deps))
      .rejects.toBeInstanceOf(AdultVerificationRateLimitedError);
    await expect(beginAdultVerification({ userId: 'u', presentation: 'page', returnPath: '/my' },
      dependencies({}, { begin_adult_verification: new Error('adult_verification_account_blocked') }).deps))
      .rejects.toBeInstanceOf(AdultVerificationAccountBlockedError);
  });

  it('KCP 거래등록이 실패하면 세션을 실패로 닫는다', async () => {
    const { deps, calls } = dependencies({
      register: vi.fn(async () => { throw new KcpCertRequestError('kcp_registration_s302'); }),
    }, { begin_adult_verification: { sessionId: SESSION_ID, providerOrderId: PROVIDER_ORDER_ID } });

    await expect(beginAdultVerification({ userId: 'u', presentation: 'page', returnPath: '/my' }, deps))
      .rejects.toBeInstanceOf(AdultVerificationUnavailableError);
    expect(calls.at(-1)).toEqual({
      fn: 'fail_adult_verification_registration',
      args: { p_session_id: SESSION_ID, p_result_code: 'kcp_registration_s302' },
    });
  });
});

describe('processKcpCertReturn', () => {
  const claimed = {
    claimStatus: 'claimed',
    sessionId: SESSION_ID,
    providerMode: 'test',
    providerOrderId: PROVIDER_ORDER_ID,
    registrationKey: '1234567890123456',
  };

  it('성공 콜백이면 KCP에 직접 조회해 성인 판정과 키 해시를 보류로 적는다', async () => {
    const { deps, calls } = dependencies({}, { claim_adult_verification_callback: claimed });

    const outcome = await processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, deps);

    expect(outcome).toEqual({ kind: 'confirm', ticket: TICKET });
    expect(calls[0]).toEqual({
      fn: 'claim_adult_verification_callback',
      args: {
        p_callback_nonce_digest: NONCE_DIGEST,
        p_registration_key: '1234567890123456',
        p_claim_token: CLAIM_TOKEN,
        p_completion_token_digest: COMPLETION_TOKEN_DIGEST,
      },
    });
    expect(deps.fetchResult).toHaveBeenCalledWith(config, { providerOrderId: PROVIDER_ORDER_ID, registrationKey: '1234567890123456' });
    const expectedSubject = createHmac('sha256', config.digestSecret).update('adult-verification/subject/di\u0000di-value').digest('hex');
    const expectedTransaction = createHmac('sha256', config.digestSecret).update('adult-verification/kcp/per-cert-no\u000025284339349648').digest('hex');
    expect(calls[1]).toEqual({
      fn: 'stage_adult_verification_result',
      args: {
        p_session_id: SESSION_ID,
        p_claim_token: CLAIM_TOKEN,
        p_outcome: 'adult',
        p_subject_digest: expectedSubject,
        p_transaction_digest: expectedTransaction,
        p_policy_version: ADULT_VERIFICATION_POLICY_VERSION,
      },
    });
    // 원문 값과 완료 토큰 원문은 어디에도 넘기지 않는다.
    expect(JSON.stringify(calls)).not.toMatch(/19900101|di-value|25284339349648/);
    expect(JSON.stringify(calls)).not.toContain(COMPLETION_TOKEN);
  });

  it('청소년 판정은 명의·거래 해시 없이 보류한다', async () => {
    const { deps, calls } = dependencies({
      fetchResult: vi.fn(async () => ({ birthDay: '20080101', duplicateInfo: 'di-value', transactionNo: '1' })),
    }, { claim_adult_verification_callback: claimed });

    await processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, deps);

    expect(calls[1]?.args).toMatchObject({ p_outcome: 'underage', p_subject_digest: null, p_transaction_digest: null });
  });

  /* 실패로 닫은 세션도 선점한 브라우저가 확정 경로에서 실패 결과를 보도록 티켓을 준다. */
  it('인증창 실패 코드는 조회 없이 세션을 실패로 닫는다', async () => {
    const { deps, calls } = dependencies({}, { claim_adult_verification_callback: claimed });

    await expect(processKcpCertReturn({ nonce: NONCE, resultCode: '3001', registrationKey: '1234567890123456' }, deps))
      .resolves.toEqual({ kind: 'confirm', ticket: TICKET });
    expect(deps.fetchResult).not.toHaveBeenCalled();
    expect(calls[1]).toEqual({
      fn: 'fail_adult_verification_callback',
      args: { p_session_id: SESSION_ID, p_claim_token: CLAIM_TOKEN, p_result_code: 'kcp_window_3001' },
    });
  });

  it('조회 실패·판정 불가 생년월일은 실패로 닫는다', async () => {
    const failing = dependencies({
      fetchResult: vi.fn(async () => { throw new KcpCertRequestError('kcp_result_decrypt'); }),
    }, { claim_adult_verification_callback: claimed });
    await processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, failing.deps);
    expect(failing.calls[1]?.args).toMatchObject({ p_result_code: 'kcp_result_decrypt' });

    const invalidBirthDay = dependencies({
      fetchResult: vi.fn(async () => ({ birthDay: '20300101', duplicateInfo: 'd', transactionNo: '1' })),
    }, { claim_adult_verification_callback: claimed });
    await processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, invalidBirthDay.deps);
    expect(invalidBirthDay.calls[1]?.args).toMatchObject({ p_result_code: 'kcp_result_birth_day' });
  });

  /* 재전송·다른 브라우저의 콜백에는 확정 티켓을 주지 않는다 — 티켓은 선점한 브라우저의 것이다. */
  it('이미 선점·보류·종결된 세션은 다시 조회하지 않고 티켓 없이 확정 경로로 보낸다', async () => {
    for (const claimStatus of ['in_progress', 'staged', 'terminal']) {
      const { deps, calls } = dependencies({}, { claim_adult_verification_callback: { claimStatus } });
      await expect(processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, deps))
        .resolves.toEqual({ kind: 'confirm', ticket: null });
      expect(calls).toHaveLength(1);
      expect(deps.fetchResult).not.toHaveBeenCalled();
    }
  });

  it('형식이 깨진 콜백과 모르는 세션은 아무것도 바꾸지 않는다', async () => {
    const { deps, calls } = dependencies({}, { claim_adult_verification_callback: new Error('adult_verification_callback_invalid') });
    await expect(processKcpCertReturn({ nonce: 'short', resultCode: '0000', registrationKey: '1' }, deps)).resolves.toEqual({ kind: 'invalid' });
    await expect(processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: null }, deps)).resolves.toEqual({ kind: 'invalid' });
    await expect(processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: 'has space' }, deps)).resolves.toEqual({ kind: 'invalid' });
    expect(calls).toEqual([]);
    await expect(processKcpCertReturn({ nonce: NONCE, resultCode: '0000', registrationKey: '1234567890123456' }, deps))
      .resolves.toEqual({ kind: 'invalid' });
  });
});

type CompletionRpc = Parameters<typeof completeAdultVerification>[1];

function completionRpc(data: unknown, error: { message: string } | null = null) {
  const mock = vi.fn(async (...call: [string, Record<string, unknown>]) => {
    void call;
    return { data, error };
  });
  return { mock, rpc: mock as unknown as CompletionRpc };
}

describe('adult verification ticket', () => {
  it('nonce와 완료 토큰을 점으로 묶고 형식이 맞는 값만 되읽는다', () => {
    expect(adultVerificationTicketValue(TICKET)).toBe(`${NONCE}.${COMPLETION_TOKEN}`);
    expect(parseAdultVerificationTicket(`${NONCE}.${COMPLETION_TOKEN}`)).toEqual(TICKET);
    expect(parseAdultVerificationTicket(null)).toBeNull();
    expect(parseAdultVerificationTicket(NONCE)).toBeNull();
    expect(parseAdultVerificationTicket(`${NONCE}.${COMPLETION_TOKEN}.x`)).toBeNull();
    expect(parseAdultVerificationTicket(`${NONCE}.short`)).toBeNull();
    expect(parseAdultVerificationTicket(`${NONCE}.${'*'.repeat(43)}`)).toBeNull();
  });
});

describe('completeAdultVerification', () => {
  it('로그인 세션 rpc로 nonce·완료 토큰 다이제스트를 확정하고 돌아갈 경로를 다시 좁힌다', async () => {
    const { mock, rpc } = completionRpc({ outcome: 'verified', presentation: 'popup', returnPath: '/shop/g1' });
    await expect(completeAdultVerification(TICKET, rpc)).resolves.toEqual({
      outcome: 'verified', presentation: 'popup', returnPath: '/shop/g1',
    });
    expect(mock).toHaveBeenCalledWith('complete_my_adult_verification', {
      p_callback_nonce_digest: NONCE_DIGEST,
      p_completion_token_digest: COMPLETION_TOKEN_DIGEST,
    });
  });

  it('DB가 답한 거절 사유만 결과로 돌려준다', async () => {
    await expect(completeAdultVerification({ nonce: 'bad', token: COMPLETION_TOKEN }, completionRpc(null).rpc))
      .resolves.toEqual({ outcome: 'not_found' });
    await expect(completeAdultVerification(TICKET, completionRpc(null, { message: 'adult_verification_not_found' }).rpc))
      .resolves.toEqual({ outcome: 'not_found' });
    await expect(completeAdultVerification(TICKET, completionRpc(null, { message: 'adult_verification_account_blocked' }).rpc))
      .resolves.toEqual({ outcome: 'blocked' });
    await expect(completeAdultVerification(TICKET, completionRpc(null, { message: 'auth required' }).rpc))
      .resolves.toEqual({ outcome: 'login_required' });
  });

  /* 장애·깨진 응답을 "없는 인증"으로 접으면 사용자가 다시 확인할 길을 잃는다. */
  it('그 밖의 실패와 깨진 응답은 던진다', async () => {
    await expect(completeAdultVerification(TICKET, completionRpc(null, { message: 'connection reset' }).rpc))
      .rejects.toBeInstanceOf(AdultVerificationCompletionError);
    await expect(completeAdultVerification(TICKET, completionRpc({ outcome: 'hacked', presentation: 'page' }).rpc))
      .rejects.toBeInstanceOf(AdultVerificationCompletionError);
    await expect(completeAdultVerification(TICKET, completionRpc(null).rpc))
      .rejects.toBeInstanceOf(AdultVerificationCompletionError);
  });

  it('돌아갈 경로가 화면 경로가 아니면 마이페이지로 바꾼다', async () => {
    await expect(completeAdultVerification(TICKET, completionRpc({ outcome: 'failed', presentation: 'page', returnPath: '/api/x' }).rpc))
      .resolves.toEqual({ outcome: 'failed', presentation: 'page', returnPath: '/my' });
  });
});
