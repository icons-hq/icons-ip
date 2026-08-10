import 'server-only';

/* 트랜잭션 이메일 provider 경계(#180).
 *
 * 앱은 이 함수 하나만 알고 provider의 SDK를 모른다. 기본 구현은 Resend 호환 HTTP JSON —
 * 의존성을 늘리지 않으려고 SDK 대신 fetch를 쓴다. 같은 모양의 API면 EMAIL_PROVIDER_ENDPOINT
 * 만 바꿔 갈아끼우고, 모양이 다르면 이 파일만 교체한다.
 *
 * env가 없으면 조용히 건너뛴다. 로컬·CI에서 빌드와 테스트가 깨지면 안 되고, 발송 실패가
 * 주문 확정을 막아서도 안 된다 — 결제 확정의 진실원은 토스 웹훅이다(AGENTS.md).
 * 키는 서버 전용 env로만 읽는다. 공개 접두(public) env를 쓰면 클라이언트 번들에 박힌다. */

const DEFAULT_ENDPOINT = 'https://api.resend.com/emails';
/** 토스 웹훅은 10초 안에 200을 받아야 재전송하지 않는다. 메일 발송이 그 예산을 먹지 않게 짧게 끊는다. */
const DEFAULT_TIMEOUT_MS = 5_000;

export interface TransactionalEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailSendOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export function getEmailProviderConfig() {
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  const from = process.env.EMAIL_FROM;
  return {
    apiKey,
    from,
    replyTo: process.env.EMAIL_REPLY_TO,
    endpoint: process.env.EMAIL_PROVIDER_ENDPOINT || DEFAULT_ENDPOINT,
    isConfigured: Boolean(apiKey && from),
  };
}

export async function sendTransactionalEmail(
  message: TransactionalEmailMessage,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EmailSendOutcome> {
  const config = getEmailProviderConfig();
  if (!config.isConfigured) {
    console.info(`[email] provider not configured — skipped "${message.subject}"`);
    return { status: 'skipped', reason: 'provider_not_configured' };
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { status: 'failed', error: `provider responded ${response.status} ${body}`.slice(0, 500) };
    }
    return { status: 'sent' };
  } catch (error) {
    return {
      status: 'failed',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
}
