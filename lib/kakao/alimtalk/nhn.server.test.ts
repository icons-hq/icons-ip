import { describe, expect, it, vi } from 'vitest';
import { KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE } from '@/lib/auth/contact-channels';
import { NHN_ALIMTALK_ENDPOINT, createNhnAlimtalkSender, kakaoAlimtalkConfig, type KakaoAlimtalkConfig } from './nhn.server';

const SENDER_KEY = 'a'.repeat(40);
const ENV = {
  ICONS_KAKAO_ALIMTALK_ENABLED: 'true',
  NHN_ALIMTALK_APP_KEY: 'AppKey1234abcd',
  NHN_ALIMTALK_SECRET_KEY: 'Secret12',
  NHN_ALIMTALK_SENDER_KEY: SENDER_KEY,
  NHN_ALIMTALK_TEMPLATE_ORDER_CONFIRMATION: 'XSQ_ORDER_PAID',
  NHN_ALIMTALK_TEMPLATE_ORDER_SHIPPED: 'XSQ_ORDER_SHIPPED',
};
const CONFIG: KakaoAlimtalkConfig = {
  appKey: 'AppKey1234abcd', secretKey: 'Secret12', senderKey: SENDER_KEY,
  templateCodes: { order_confirmation: 'XSQ_ORDER_PAID', order_shipped: 'XSQ_ORDER_SHIPPED' },
};
const MESSAGE = {
  templateCode: 'XSQ_ORDER_PAID',
  recipientNo: '01012345678',
  templateParameter: { 주문번호: '2026111910000001', 굿즈명: '키링', 결제금액: '32,000', 주문ID: 'order-id' },
  idempotencyKey: '61000000-0000-4000-8000-000000000001',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function success(requestId = '20261119-request.1') {
  return json(200, { header: { resultCode: 0, resultMessage: 'SUCCESS', isSuccessful: true },
    message: { requestId, sendResults: [{ recipientSeq: 1, recipientNo: '01012345678', resultCode: 0, resultMessage: 'SUCCESS' }] } });
}

describe('kakaoAlimtalkConfig', () => {
  it('스위치·키·템플릿 코드가 모두 맞을 때만 설정을 만든다(Preview·로컬은 방침 게이트 없이)', () => {
    expect(kakaoAlimtalkConfig(ENV)).toEqual(CONFIG);
    expect(kakaoAlimtalkConfig({ ...ENV, ICONS_KAKAO_ALIMTALK_ENABLED: 'TRUE' })).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, ICONS_KAKAO_ALIMTALK_ENABLED: undefined })).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_APP_KEY: '' })).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_SECRET_KEY: 'has space' })).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_SENDER_KEY: 'a'.repeat(39) })).toBeNull();
  });

  it('템플릿 코드는 안내마다 따로 켜고, 모양이 틀린 코드나 코드가 하나도 없으면 전체를 닫는다', () => {
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_TEMPLATE_ORDER_SHIPPED: ' ' })?.templateCodes)
      .toEqual({ order_confirmation: 'XSQ_ORDER_PAID', order_shipped: null });
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_TEMPLATE_ORDER_SHIPPED: 'X'.repeat(21) })).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, NHN_ALIMTALK_TEMPLATE_ORDER_CONFIRMATION: '', NHN_ALIMTALK_TEMPLATE_ORDER_SHIPPED: '' })).toBeNull();
  });

  it('운영은 처리방침 개정 시행일(KST 0시) 전에는 env를 다 넣어도 닫혀 있다', () => {
    expect(KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE).not.toBeNull();
    const effectiveStart = new Date(`${KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE}T00:00:00+09:00`);
    expect(kakaoAlimtalkConfig({ ...ENV, VERCEL_ENV: 'production' }, new Date(effectiveStart.getTime() - 1000))).toBeNull();
    expect(kakaoAlimtalkConfig({ ...ENV, VERCEL_ENV: 'production' }, effectiveStart)).toEqual(CONFIG);
    expect(kakaoAlimtalkConfig({ ...ENV, VERCEL_ENV: 'preview' })).toEqual(CONFIG);
  });
});

describe('createNhnAlimtalkSender', () => {
  it('치환 발송 API에 발신 키·템플릿 코드·수신자 하나와 중복 방지 키를 보낸다', async () => {
    const fetch = vi.fn(async () => success());
    const sender = createNhnAlimtalkSender(CONFIG, { fetch, log: vi.fn() });
    await expect(sender.send(MESSAGE)).resolves.toEqual({ status: 'sent', requestId: '20261119-request.1' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${NHN_ALIMTALK_ENDPOINT}/AppKey1234abcd/messages`);
    expect(url).toBe('https://kakaotalk-bizmessage.api.nhncloudservice.com/alimtalk/v2.3/appkeys/AppKey1234abcd/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Secret-Key': 'Secret12',
      'X-NC-API-IDEMPOTENCY-KEY': MESSAGE.idempotencyKey,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      senderKey: SENDER_KEY,
      templateCode: 'XSQ_ORDER_PAID',
      /* 콘솔의 대체 발송 설정과 무관하게 문자로 넘기지 않는다. */
      recipientList: [{ recipientNo: '01012345678', templateParameter: MESSAGE.templateParameter, resendParameter: { isResend: false } }],
    });
  });

  it('확실한 거절은 failed, 받았을 수도 있는 응답은 unknown이다', async () => {
    const cases: [Response | Error, unknown][] = [
      [json(401, { header: { resultCode: -1000, isSuccessful: false } }), { status: 'failed', error: 'provider_http_401' }],
      [json(200, { header: { resultCode: -3000, resultMessage: 'invalid', isSuccessful: false } }), { status: 'failed', error: 'provider_result_-3000' }],
      [json(200, { header: { resultCode: 0, isSuccessful: true }, message: { requestId: 'r', sendResults: [{ resultCode: -3018 }] } }), { status: 'failed', error: 'recipient_result_-3018' }],
      [json(503, {}), { status: 'unknown', error: 'provider_http_503' }],
      [new Error('timeout'), { status: 'unknown', error: 'provider_network' }],
      [new Response('not json', { status: 200 }), { status: 'unknown', error: 'provider_unreadable' }],
      [json(200, { header: { resultCode: 0, isSuccessful: true }, message: { requestId: 'r', sendResults: [] } }), { status: 'unknown', error: 'provider_unreadable' }],
    ];
    for (const [outcome, expected] of cases) {
      const fetch = vi.fn(async () => { if (outcome instanceof Error) throw outcome; return outcome; });
      await expect(createNhnAlimtalkSender(CONFIG, { fetch, log: vi.fn() }).send(MESSAGE)).resolves.toEqual(expected);
    }
  });

  it('요청 id가 이상한 모양이면 버리고, 로그에는 비밀값·번호·본문을 남기지 않는다', async () => {
    const log = vi.fn();
    await expect(createNhnAlimtalkSender(CONFIG, { fetch: vi.fn(async () => success('bad id with spaces')), log }).send(MESSAGE))
      .resolves.toEqual({ status: 'sent', requestId: null });
    await createNhnAlimtalkSender(CONFIG, { fetch: vi.fn(async () => json(400, { header: { resultCode: -1, isSuccessful: false } })), log }).send(MESSAGE);
    const lines = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(lines).toContain('status=400');
    for (const secret of ['Secret12', SENDER_KEY, '01012345678', '키링', 'AppKey1234abcd']) expect(lines).not.toContain(secret);
  });
});
