/**
 * 채널별 마케팅 정보 수신 동의(10/14 회의 S4).
 *
 * 원장은 DB `private.customer_marketing_consents`(현재 선택·동의/철회 시각·안내 버전)와
 * 이력 `private.customer_marketing_consent_events`다. 기존 `profiles.consents.marketing`은
 * "어느 채널이든 하나라도 동의 = true"인 파생값으로 남아 고객 세그먼트·인앱 메시지·어드민
 * 회원 상세가 그대로 읽는다(migration 20261027110000). 앱이 바꾸는 길은
 * `set_my_marketing_consents` RPC 하나다. 원장 밖의 직접 쓰기(배포 창의 옛 앱·운영 SQL)는 DB 트리거가
 * 원장에 반영한다(false=전 수단 철회, true=이메일 동의 legacy_app).
 *
 * 안내 문구를 바꾸면 버전도 올린다 — DB가 받는 버전 목록과 함께 바꿔야 한다.
 */
import { transactionInstant, transactionRecord } from './goods-transaction-values';

export const MARKETING_CONSENT_NOTICE_VERSION = 'marketing-channels-v1';
export const MARKETING_CHANNELS = ['email', 'sms'] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export type MarketingConsentSource = 'onboarding' | 'settings';

export const MARKETING_CHANNEL_LABELS: Record<MarketingChannel, string> = {
  email: '이메일',
  sms: 'SMS',
};

/** 폼 필드 이름. 온보딩과 설정이 같은 이름을 쓴다. */
export const MARKETING_CHANNEL_FIELDS: Record<MarketingChannel, string> = {
  email: 'marketingEmail',
  sms: 'marketingSms',
};

export const MARKETING_CONSENT_NOTICE = {
  title: '마케팅 정보 수신 동의',
  summary: '신상품·이벤트·할인 혜택 같은 광고성 정보를 동의한 수단으로 보내 드려요. 동의하지 않아도 가입과 구매에 불이익이 없고, 주문·배송 같은 거래 안내는 동의와 관계없이 보내 드려요.',
  sms: 'SMS는 휴대폰 번호가 등록된 경우에만 보내 드려요.',
  change: '설정에서 수단별로 언제든 바꿀 수 있어요.',
} as const;

export interface MarketingChannelConsent {
  agreed: boolean;
  agreedAt: string | null;
  withdrawnAt: string | null;
  noticeVersion: string;
}

export interface MarketingConsentState {
  marketing: boolean;
  email: MarketingChannelConsent | null;
  sms: MarketingChannelConsent | null;
}

export type MarketingChannelChoices = Record<MarketingChannel, boolean>;

function nullableInstant(value: unknown): value is string | null {
  return value === null || transactionInstant(value);
}

function parseChannel(value: unknown): MarketingChannelConsent | null | undefined {
  if (value === null) return null;
  if (!transactionRecord(value) || typeof value.agreed !== 'boolean' || typeof value.noticeVersion !== 'string'
    || !nullableInstant(value.agreedAt) || !nullableInstant(value.withdrawnAt)
    || value.agreed !== (value.agreedAt !== null)) return undefined;
  return { agreed: value.agreed, agreedAt: value.agreedAt, withdrawnAt: value.withdrawnAt, noticeVersion: value.noticeVersion };
}

/** RPC 응답을 검증한다. 모양이 다르면 null — 화면은 기본값(미동의)으로 그린다. */
export function parseMarketingConsentState(value: unknown): MarketingConsentState | null {
  if (!transactionRecord(value) || typeof value.marketing !== 'boolean') return null;
  const email = parseChannel(value.email);
  const sms = parseChannel(value.sms);
  if (email === undefined || sms === undefined) return null;
  if (value.marketing !== Boolean(email?.agreed || sms?.agreed)) return null;
  return { marketing: value.marketing, email, sms };
}

export function marketingChannelChoices(state: MarketingConsentState | null | undefined): MarketingChannelChoices {
  return { email: state?.email?.agreed === true, sms: state?.sms?.agreed === true };
}

export function readMarketingChannelChoices(formData: FormData): MarketingChannelChoices {
  return {
    email: formData.get(MARKETING_CHANNEL_FIELDS.email) === 'on',
    sms: formData.get(MARKETING_CHANNEL_FIELDS.sms) === 'on',
  };
}

const CONSENT_DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' });

export function formatMarketingConsentDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : CONSENT_DATE.format(date);
}

/**
 * 저장 결과 안내. 정보통신망법 제50조 제7항의 처리 결과 고지(전송자·수단별 동의/거부·처리 일자)를
 * 저장한 그 화면에서 바로 보여 준다.
 */
export function marketingConsentResultMessage(choices: MarketingChannelChoices, at: Date): string {
  const parts = MARKETING_CHANNELS.map((channel) => `${MARKETING_CHANNEL_LABELS[channel]} ${choices[channel] ? '수신 동의' : '수신 거부'}`);
  return `ICONS 마케팅 정보 수신 설정을 저장했어요 · ${parts.join(' · ')} · ${formatMarketingConsentDate(at)} 처리`;
}
