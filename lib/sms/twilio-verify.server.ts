import 'server-only';

import type { SmsMessage, SmsSendResult, SmsSender } from './sender.server';

/*
 * Twilio Verify 발송(2026-11-17 연결 — 휴대폰 번호 인증 전용).
 *
 * 왜 Verify인가: 한국 수신은 Twilio에서 국제 발신 번호로만 갈 수 있고(알파벳 발신자·국내 번호 미지원, 단말에는
 * [국제발신]·[Web발신]이 붙는다), Messages API를 쓰려면 번호를 사서 발신자를 따로 관리해야 한다. Verify는 Twilio의
 * 인증 문자 전용 발신 경로·템플릿·사기 방지(Fraud Guard)를 그대로 쓰므로 번호 없이 바로 보낼 수 있다.
 *
 * 인증번호는 지금처럼 우리 서버가 만들고 DB가 HMAC으로 판정한다(만 14세·동의·한도·5회 잠금·번호 옮기기는 그대로).
 * Verify에는 그 번호를 CustomCode로 넘겨 문자만 보내게 한다 — 서비스 설정에서 'Custom Verification Code'를 켜야 한다
 * (꺼져 있으면 403 · 60204). Custom Code를 쓰면 Twilio에 인증 결과를 알려야 하므로(피드백), DB가 확인을 마친 뒤
 * 같은 번호의 Verification을 approved로 바꾼다(confirmVerification).
 *
 * 거래 안내·광고 문자(sendMemberSms)는 Verify로 보낼 수 없다 — 이 발송기는 인증번호 외 목적을 보내지 않고 닫힌다.
 * 비밀값(API Key Secret)은 서버 env로만 받고 로그·응답에 남기지 않는다. 로그에는 상태 코드와 Twilio 오류 번호만 남긴다.
 */

const VERIFY_BASE_URL = 'https://verify.twilio.com/v2/Services';
const REQUEST_TIMEOUT_MS = 10_000;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TwilioVerifyConfig {
  apiKeySid: string;
  apiKeySecret: string;
  serviceSid: string;
}

/** TWILIO_API_KEY_SID(SK…)·TWILIO_API_KEY_SECRET·TWILIO_VERIFY_SERVICE_SID(VA…)가 모두 맞는 모양일 때만 설정을 만든다. */
export function twilioVerifyConfigFromEnvironment(env: RuntimeEnvironment): TwilioVerifyConfig | null {
  const apiKeySid = env.TWILIO_API_KEY_SID?.trim() ?? '';
  const apiKeySecret = env.TWILIO_API_KEY_SECRET?.trim() ?? '';
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim() ?? '';
  if (!/^SK[0-9a-f]{32}$/i.test(apiKeySid)) return null;
  if (apiKeySecret.length < 16) return null;
  if (!/^VA[0-9a-f]{32}$/i.test(serviceSid)) return null;
  return { apiKeySid, apiKeySecret, serviceSid };
}

/** 한국 번호는 한국어 템플릿, 그 밖은 영어. 템플릿 문장은 Twilio Verify 서비스가 정한다. */
export function twilioVerifyLocale(e164: string): 'ko' | 'en' {
  return e164.startsWith('+82') ? 'ko' : 'en';
}

function authorization(config: TwilioVerifyConfig) {
  return `Basic ${Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64')}`;
}

async function twilioErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { code?: unknown };
    return typeof body.code === 'number' || typeof body.code === 'string' ? String(body.code) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/* 401·403(키·권한·Custom Code 미설정)·404(서비스 없음)·429·5xx는 우리 쪽 설정·일시 장애다. 그 밖의 4xx는 그 번호로
   보낼 수 없다는 거절이다(잘못된 번호·유선 번호·지역 권한·발송 한도). 화면 문구는 둘 다 같다. */
function failureReason(status: number): 'rejected' | 'unavailable' {
  if (status >= 500 || status === 401 || status === 403 || status === 404 || status === 429) return 'unavailable';
  return 'rejected';
}

export function createTwilioVerifySender(
  config: TwilioVerifyConfig,
  options: { fetch?: FetchLike; log?: (line: string) => void } = {},
): SmsSender {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const log = options.log ?? console.error;
  const serviceUrl = `${VERIFY_BASE_URL}/${encodeURIComponent(config.serviceSid)}/Verifications`;

  async function post(url: string, body: URLSearchParams): Promise<Response> {
    return fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: authorization(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  return {
    provider: 'twilio_verify',
    async send(message: SmsMessage): Promise<SmsSendResult> {
      if (message.purpose !== 'phone_verification' || !message.code) return { ok: false, reason: 'unavailable' };
      let response: Response;
      try {
        response = await post(serviceUrl, new URLSearchParams({
          To: message.to,
          Channel: 'sms',
          CustomCode: message.code,
          Locale: twilioVerifyLocale(message.to),
        }));
      } catch {
        log('[sms:twilio_verify] send failed status=network');
        return { ok: false, reason: 'unavailable' };
      }
      if (!response.ok) {
        log(`[sms:twilio_verify] send failed status=${response.status} code=${await twilioErrorCode(response)}`);
        return { ok: false, reason: failureReason(response.status) };
      }
      try {
        const body = await response.json() as { sid?: unknown };
        return { ok: true, providerMessageId: typeof body.sid === 'string' ? body.sid : null };
      } catch {
        return { ok: true, providerMessageId: null };
      }
    },
    /* Custom Code 피드백: 우리 DB가 인증을 마친 번호의 진행 중 Verification을 approved로 바꾼다. 실패해도 인증 결과는
       바뀌지 않는다(판정은 DB가 이미 했다) — 상태 코드만 남긴다. */
    async confirmVerification(to: string): Promise<boolean> {
      try {
        const response = await post(`${serviceUrl}/${encodeURIComponent(to)}`, new URLSearchParams({ Status: 'approved' }));
        if (response.ok) return true;
        log(`[sms:twilio_verify] approve failed status=${response.status} code=${await twilioErrorCode(response)}`);
        return false;
      } catch {
        log('[sms:twilio_verify] approve failed status=network');
        return false;
      }
    },
  };
}
