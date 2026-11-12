import 'server-only';

import { contactChannelsLegalGateOpen, envSwitchOn } from '@/lib/auth/contact-channels';
import { createServiceClient } from '@/lib/supabase/service';
import { smsSenderFromEnvironment, type SmsSender } from './sender.server';

/*
 * 회원 SMS 알림 seam(10/14 회의 1014-010 — 구매 전 회원에게 이메일 말고도 알릴 수단). 기본 OFF.
 *
 * 아직 이 seam을 부르는 기능은 없다. IP 소식·이벤트 알림 같은 생산자를 만들 때 이 함수 하나로 보내고, 그때 발송
 * 기록(누구에게·언제·무엇을, 본문 제외)과 재시도를 이메일 dispatcher처럼 함께 설계한다(런북 참고).
 *
 * 법적 경계(정보통신망법 제50조, 시행령 제61조 — 런북에 근거 정리):
 *   · 광고성 정보(advertising)는 SMS 수신 동의가 있는 회원에게만 보낸다. 받는 사람은 DB(service_member_sms_recipient)가
 *     인증된 휴대폰 번호와 동의 원장으로 정한다 — 앱이 동의를 짐작하지 않는다.
 *   · 광고성 정보는 본문 앞에 '(광고)'와 전송자 명칭을, 끝에 무료 수신거부 방법을 붙인다. 수신거부 문구
 *     (ICONS_SMS_ADVERTISING_OPT_OUT, 예: '무료수신거부 080-000-0000')가 없으면 보내지 않는다.
 *   · 오후 9시부터 다음 날 오전 8시(KST)에는 광고성 정보를 보내지 않는다(야간 별도 동의를 받지 않는다).
 *   · 주문·배송 같은 거래 안내(transactional)는 동의와 무관하지만, 역시 인증된 번호로만 보낸다.
 */

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type MemberSmsKind = 'advertising' | 'transactional';

export interface SmsNotificationConfig {
  sender: SmsSender;
  /** 광고성 정보의 무료 수신거부 문구. 없으면 광고성 정보는 보내지 않는다. */
  advertisingOptOut: string | null;
}

export const SMS_SENDER_NAME = 'ICONS';
const MAX_BODY_LENGTH = 1000;

export function smsNotificationConfig(env: RuntimeEnvironment = process.env, now: Date = new Date()): SmsNotificationConfig | null {
  if (!envSwitchOn(env, 'ICONS_SMS_NOTIFICATIONS_ENABLED')) return null;
  if (!contactChannelsLegalGateOpen(env, now)) return null;
  const sender = smsSenderFromEnvironment(env);
  if (!sender) return null;
  const optOut = env.ICONS_SMS_ADVERTISING_OPT_OUT?.trim() ?? '';
  return { sender, advertisingOptOut: optOut.length > 0 && optOut.length <= 60 ? optOut : null };
}

const KST_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' });

/** 광고성 정보를 보낼 수 없는 야간(KST 21:00–08:00). */
export function isAdvertisingQuietHours(now: Date): boolean {
  const hour = Number(KST_HOUR.format(now));
  return hour >= 21 || hour < 8;
}

/** 광고성 SMS 본문. (광고) 표시·전송자 명칭을 앞에, 무료 수신거부 방법을 끝에 둔다. */
export function advertisingSmsText(body: string, optOut: string): string {
  return `(광고)${SMS_SENDER_NAME}\n${body}\n${optOut}`;
}

export type MemberSmsResult =
  | { sent: true; providerMessageId: string | null }
  | { sent: false; reason: 'disabled' | 'invalid_body' | 'opt_out_missing' | 'quiet_hours' | 'no_verified_phone' | 'consent_required' | 'account_unavailable' | 'unavailable' };

type ServiceClient = ReturnType<typeof createServiceClient>;

export async function sendMemberSms(
  input: { userId: string; kind: MemberSmsKind; body: string; now?: Date },
  deps: { config?: SmsNotificationConfig | null; service?: ServiceClient } = {},
): Promise<MemberSmsResult> {
  const now = input.now ?? new Date();
  const config = deps.config === undefined ? smsNotificationConfig(process.env, now) : deps.config;
  if (!config) return { sent: false, reason: 'disabled' };
  const body = input.body.trim();
  if (!body || body.length > MAX_BODY_LENGTH) return { sent: false, reason: 'invalid_body' };
  if (input.kind === 'advertising') {
    if (!config.advertisingOptOut) return { sent: false, reason: 'opt_out_missing' };
    if (isAdvertisingQuietHours(now)) return { sent: false, reason: 'quiet_hours' };
  }

  try {
    const service = deps.service ?? createServiceClient();
    const { data, error } = await service.rpc('service_member_sms_recipient', { p_user_id: input.userId, p_purpose: input.kind });
    const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (error || !result) return { sent: false, reason: 'unavailable' };
    if (result.ok !== true || typeof result.phoneE164 !== 'string') {
      const reason = result.reason;
      return {
        sent: false,
        reason: reason === 'no_verified_phone' || reason === 'consent_required' || reason === 'account_unavailable' ? reason : 'unavailable',
      };
    }
    const text = input.kind === 'advertising' ? advertisingSmsText(body, config.advertisingOptOut as string) : `[${SMS_SENDER_NAME}] ${body}`;
    const sent = await config.sender.send({ to: result.phoneE164, text, purpose: input.kind });
    return sent.ok ? { sent: true, providerMessageId: sent.providerMessageId } : { sent: false, reason: 'unavailable' };
  } catch {
    return { sent: false, reason: 'unavailable' };
  }
}
