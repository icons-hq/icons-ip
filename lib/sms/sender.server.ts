import 'server-only';

import { CHINA_SMS_PRIVACY_EFFECTIVE_DATE, contactChannelsLegalGateOpen } from '@/lib/auth/contact-channels';
import { chinaSensSenderFromEnvironment } from './naver-sens.server';
import { createTwilioVerifySender, twilioVerifyConfigFromEnvironment } from './twilio-verify.server';

/*
 * SMS 발송 seam(1014-005·006 인증번호, 1014-010 SMS 알림).
 *
 * ICONS_SMS_PROVIDER가 기본 발송사를 정하고 ICONS_SMS_CN_PROVIDER로 중국 본토의 인증문자만 SENS에 연결할 수 있다.
 *   · 없음(null) — 기본. 발송을 시도하지 않고 기능을 닫는다(fail closed).
 *   · console — 로컬 개발·시험 전용. 문자 대신 서버 로그에 남긴다. Vercel(Preview·운영)에서는 만들지 않는다.
 *   · twilio_verify — Twilio Verify(2026-11-17). 인증번호 문자 전용이다 — 거래 안내·광고 문자는 보내지 않고 닫힌다
 *     (`lib/sms/twilio-verify.server.ts`). 키가 모자라면 null이다.
 * 비밀값(발송사 키)은 서버 env로만 받고 로그·응답에 남기지 않는다.
 */

export type SmsPurpose = 'phone_verification' | 'transactional' | 'advertising';

export interface SmsMessage {
  /** E.164 */
  to: string;
  text: string;
  purpose: SmsPurpose;
  /** 인증번호(phone_verification만). 템플릿을 발송사가 정하는 발송기(Twilio Verify)는 text 대신 이 값을 넘긴다. */
  code?: string;
}

export type SmsSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; reason: 'rejected' | 'unavailable' | 'unknown' };

export interface SmsSender {
  readonly provider: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
  /** 인증 결과를 받는 발송사(Twilio Verify Custom Code)에 DB가 확인을 마친 번호를 알린다. 없는 발송사는 할 일이 없다. */
  confirmVerification?(to: string): Promise<boolean>;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function maskedRecipient(e164: string) {
  return e164.length > 6 ? `${e164.slice(0, 4)}****${e164.slice(-2)}` : '****';
}

/** 로컬 개발 전용. 인증번호를 확인할 수 있게 본문을 그대로 남기되 받는 번호는 가린다. */
export function createConsoleSmsSender(write: (line: string) => void = console.info): SmsSender {
  return {
    provider: 'console',
    async send(message) {
      write(`[sms:console] to=${maskedRecipient(message.to)} purpose=${message.purpose} text=${message.text}`);
      return { ok: true, providerMessageId: null };
    },
  };
}

/**
 * ICONS_SMS_PROVIDER로 발송 구현을 고른다. 값이 없거나 모르는 값이면 null(발송 없음)이다.
 * console은 Vercel 밖(로컬)에서만 만든다 — Preview·운영 로그에 인증번호가 남지 않게 한다.
 */
export function smsSenderFromEnvironment(env: RuntimeEnvironment = process.env, now: Date = new Date()): SmsSender | null {
  const provider = env.ICONS_SMS_PROVIDER?.trim();
  if (!provider) return null;
  if (provider === 'console') return env.VERCEL || env.VERCEL_ENV ? null : createConsoleSmsSender();
  if (provider === 'twilio_verify') {
    const config = twilioVerifyConfigFromEnvironment(env);
    if (!config) return null;
    const twilio = createTwilioVerifySender(config);
    const chinaProvider = env.ICONS_SMS_CN_PROVIDER?.trim();
    if (!chinaProvider || chinaProvider === 'twilio' || !contactChannelsLegalGateOpen(env, now, CHINA_SMS_PRIVACY_EFFECTIVE_DATE)) return twilio;
    const sens = chinaProvider === 'sens' ? chinaSensSenderFromEnvironment(env) : null;
    return {
      provider: 'twilio_verify',
      async send(message) {
        if (!message.to.startsWith('+86')) return twilio.send(message);
        return sens ? sens.send(message) : { ok: false, reason: 'unavailable' };
      },
      async confirmVerification(to) {
        if (to.startsWith('+86')) return false;
        return twilio.confirmVerification?.(to) ?? false;
      },
    };
  }
  return null;
}
