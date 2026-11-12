import 'server-only';

/*
 * SMS 발송 seam(1014-005·006 인증번호, 1014-010 SMS 알림).
 *
 * 발송사는 아직 정하지 않았다(사람 게이트 H4 — 국내 발신번호 등록, 해외 단가·도달률). 그래서 앱은 이 인터페이스에만
 * 기대고, 발송사 구현은 계약 뒤에 `smsSenderFromEnvironment`에 하나 더한다. 지금 있는 구현은 둘이다.
 *   · 없음(null) — 기본. 발송을 시도하지 않고 기능을 닫는다(fail closed).
 *   · console — 로컬 개발·시험 전용. 문자 대신 서버 로그에 남긴다. Vercel(Preview·운영)에서는 만들지 않는다.
 * 비밀값(발송사 키)은 서버 env로만 받고 로그·응답에 남기지 않는다.
 */

export type SmsPurpose = 'phone_verification' | 'transactional' | 'advertising';

export interface SmsMessage {
  /** E.164 */
  to: string;
  text: string;
  purpose: SmsPurpose;
}

export type SmsSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; reason: 'rejected' | 'unavailable' };

export interface SmsSender {
  readonly provider: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
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
export function smsSenderFromEnvironment(env: RuntimeEnvironment = process.env): SmsSender | null {
  const provider = env.ICONS_SMS_PROVIDER?.trim();
  if (!provider) return null;
  if (provider === 'console') return env.VERCEL || env.VERCEL_ENV ? null : createConsoleSmsSender();
  return null;
}
