import 'server-only';

import { KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE, contactChannelsLegalGateOpen, envSwitchOn } from '@/lib/auth/contact-channels';
import type { AlimtalkTemplateName } from './templates';

/*
 * NHN Cloud 알림톡(KakaoTalk Bizmessage) 발송 — 치환 발송 API v2.3.
 *
 * 카카오는 알림톡 API를 직접 주지 않아 공식 딜러사(NHN Cloud)를 거친다. 카카오톡 채널(엑스 스퀘어)을 NHN 콘솔에
 * 발신 프로필로 등록해 받은 발신 키(senderKey)와, 카카오 심사를 통과한 템플릿 코드로 보낸다. 본문은 템플릿이 정하고
 * 앱은 #{변수} 값만 넘긴다(lib/kakao/alimtalk/templates.ts).
 *
 * 켜는 조건(하나라도 어긋나면 null — fail closed): ICONS_KAKAO_ALIMTALK_ENABLED=true, 운영은 방침 시행일
 * (KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE) 이후, 앱 키·시크릿 키·발신 키가 맞는 모양, 템플릿 코드가 하나 이상.
 * 비밀값은 서버 env로만 받고 로그·응답에 남기지 않는다. 로그에는 HTTP 상태와 NHN 결과 코드만 남긴다.
 *
 * 결과 해석(발송사가 받았는지가 기준 — 중복 발송을 피한다):
 *   · sent: HTTP 200 + header.isSuccessful + 수신자 결과 코드 0. 요청 id를 남긴다(최종 도달은 NHN 콘솔의 발송 조회).
 *   · failed: 확실히 받지 않았다 — HTTP 4xx, header 실패, 수신자 결과 코드 실패. 다음 훅이 다시 보낼 수 있다.
 *   · unknown: 받았을 수도 있다 — 네트워크 오류·시간 초과·5xx·읽을 수 없는 200. 자동으로 다시 보내지 않는다.
 */

export const NHN_ALIMTALK_ENDPOINT = 'https://kakaotalk-bizmessage.api.nhncloudservice.com/alimtalk/v2.3/appkeys';
/* 결제 승인 응답 경로에서 메일과 나란히 기다리므로 짧게 둔다(메일 2.5초). 시간 초과는 unknown — 다시 보내지 않는다. */
const REQUEST_TIMEOUT_MS = 3_000;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface KakaoAlimtalkConfig {
  appKey: string;
  secretKey: string;
  senderKey: string;
  /** 승인된 템플릿 코드. 비어 있는 안내는 보내지 않는다(템플릿마다 따로 켤 수 있다). */
  templateCodes: Record<AlimtalkTemplateName, string | null>;
}

const APP_KEY = /^[A-Za-z0-9]{8,64}$/;
const SECRET_KEY = /^[A-Za-z0-9]{6,128}$/;
const SENDER_KEY = /^[A-Za-z0-9]{40}$/;
const TEMPLATE_CODE = /^[A-Za-z0-9_-]{1,20}$/;

function templateCode(value: string | undefined): string | null | undefined {
  const code = value?.trim() ?? '';
  if (!code) return null;
  return TEMPLATE_CODE.test(code) ? code : undefined;
}

export function kakaoAlimtalkConfig(env: RuntimeEnvironment = process.env, now: Date = new Date()): KakaoAlimtalkConfig | null {
  if (!envSwitchOn(env, 'ICONS_KAKAO_ALIMTALK_ENABLED')) return null;
  if (!contactChannelsLegalGateOpen(env, now, KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE)) return null;
  const appKey = env.NHN_ALIMTALK_APP_KEY?.trim() ?? '';
  const secretKey = env.NHN_ALIMTALK_SECRET_KEY?.trim() ?? '';
  const senderKey = env.NHN_ALIMTALK_SENDER_KEY?.trim() ?? '';
  if (!APP_KEY.test(appKey) || !SECRET_KEY.test(secretKey) || !SENDER_KEY.test(senderKey)) return null;
  const confirmation = templateCode(env.NHN_ALIMTALK_TEMPLATE_ORDER_CONFIRMATION);
  const shipped = templateCode(env.NHN_ALIMTALK_TEMPLATE_ORDER_SHIPPED);
  /* 모양이 어긋난 코드는 오타다 — 다른 안내만 보내지 않고 전체를 닫아 설정을 바로잡게 한다. */
  if (confirmation === undefined || shipped === undefined || (!confirmation && !shipped)) return null;
  return { appKey, secretKey, senderKey, templateCodes: { order_confirmation: confirmation, order_shipped: shipped } };
}

export interface AlimtalkMessage {
  templateCode: string;
  /** 국내 휴대폰 번호(010…), 하이픈 없음. DB 클레임이 인증 번호에서 만든다. */
  recipientNo: string;
  templateParameter: Record<string, string>;
  /** NHN 중복 요청 방지 키(X-NC-API-IDEMPOTENCY-KEY, 10분). 클레임마다 새 값이다. */
  idempotencyKey: string;
}

export type AlimtalkSendResult =
  | { status: 'sent'; requestId: string | null }
  | { status: 'failed' | 'unknown'; error: string };

interface NhnResponseBody {
  header?: { resultCode?: unknown; isSuccessful?: unknown };
  message?: { requestId?: unknown; sendResults?: { resultCode?: unknown }[] | null } | null;
}

function code(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) ? String(value) : 'unknown';
}

const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

export function createNhnAlimtalkSender(
  config: KakaoAlimtalkConfig,
  options: { fetch?: FetchLike; log?: (line: string) => void } = {},
) {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const log = options.log ?? console.error;
  const url = `${NHN_ALIMTALK_ENDPOINT}/${encodeURIComponent(config.appKey)}/messages`;

  return {
    provider: 'nhn_alimtalk' as const,
    async send(message: AlimtalkMessage): Promise<AlimtalkSendResult> {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Secret-Key': config.secretKey,
            'X-NC-API-IDEMPOTENCY-KEY': message.idempotencyKey,
          },
          body: JSON.stringify({
            senderKey: config.senderKey,
            templateCode: message.templateCode,
            recipientList: [{ recipientNo: message.recipientNo, templateParameter: message.templateParameter }],
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        log('[alimtalk:nhn] send failed status=network');
        return { status: 'unknown', error: 'provider_network' };
      }
      if (response.status >= 500) {
        log(`[alimtalk:nhn] send failed status=${response.status}`);
        return { status: 'unknown', error: `provider_http_${response.status}` };
      }
      let body: NhnResponseBody | null = null;
      try {
        body = await response.json() as NhnResponseBody;
      } catch {
        body = null;
      }
      if (!response.ok) {
        log(`[alimtalk:nhn] send failed status=${response.status} code=${code(body?.header?.resultCode)}`);
        return { status: 'failed', error: `provider_http_${response.status}` };
      }
      if (!body || typeof body.header?.isSuccessful !== 'boolean') {
        log('[alimtalk:nhn] send failed status=200 code=unreadable');
        return { status: 'unknown', error: 'provider_unreadable' };
      }
      if (!body.header.isSuccessful) {
        log(`[alimtalk:nhn] send rejected code=${code(body.header.resultCode)}`);
        return { status: 'failed', error: `provider_result_${code(body.header.resultCode)}` };
      }
      const recipientCode = body.message?.sendResults?.[0]?.resultCode;
      /* 요청은 받았는데 수신자 결과를 읽을 수 없으면 접수됐을 수 있다 — 다시 보내지 않는다. */
      if (typeof recipientCode !== 'number') {
        log('[alimtalk:nhn] send failed status=200 code=no_recipient_result');
        return { status: 'unknown', error: 'provider_unreadable' };
      }
      if (recipientCode !== 0) {
        log(`[alimtalk:nhn] recipient rejected code=${code(recipientCode)}`);
        return { status: 'failed', error: `recipient_result_${code(recipientCode)}` };
      }
      const requestId = body.message?.requestId;
      return { status: 'sent', requestId: typeof requestId === 'string' && REQUEST_ID.test(requestId) ? requestId : null };
    },
  };
}

export type NhnAlimtalkSender = ReturnType<typeof createNhnAlimtalkSender>;
