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
/** 카카오톡까지 세 수단을 받는 안내 버전(1014-010). 카카오톡 채널 스위치가 켜졌을 때만 쓴다. */
export const MARKETING_CONSENT_NOTICE_VERSION_WITH_KAKAO = 'marketing-channels-v2';
/** 채널을 나누기 전 단일 동의의 안내 버전. 이관 동의(source legacy)는 실제 동의 시각이 기록된 적이 없다. */
export const MARKETING_LEGACY_NOTICE_VERSION = 'marketing-legacy-v0';
export const MARKETING_CONSENT_SOURCES = ['legacy', 'legacy_app', 'onboarding', 'settings'] as const;
export type MarketingConsentRecordSource = (typeof MARKETING_CONSENT_SOURCES)[number];
/** 기본 두 수단. 카카오톡 채널 스위치가 꺼져 있으면 화면은 이 두 줄만 그린다. */
export const MARKETING_CHANNELS = ['email', 'sms'] as const;
/** 카카오톡 채널 스위치가 켜졌을 때(또는 회원이 이미 카카오톡 수신에 동의해 있을 때) 그리는 세 수단. */
export const MARKETING_CHANNELS_WITH_KAKAO = ['email', 'sms', 'kakao'] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS_WITH_KAKAO)[number];
export type MarketingConsentSource = 'onboarding' | 'settings';

export const MARKETING_CHANNEL_LABELS: Record<MarketingChannel, string> = {
  email: '이메일',
  sms: 'SMS',
  kakao: '카카오톡',
};

/** 폼 필드 이름. 온보딩과 설정이 같은 이름을 쓴다. */
export const MARKETING_CHANNEL_FIELDS: Record<MarketingChannel, string> = {
  email: 'marketingEmail',
  sms: 'marketingSms',
  kakao: 'marketingKakao',
};

/** 화면이 카카오톡 줄을 그렸다는 표시. 체크하지 않은 체크박스는 폼에 실리지 않으므로 '그리지 않음'과 '거부'를 구분한다. */
export const MARKETING_KAKAO_OFFERED_FIELD = 'marketingKakaoOffered';

export const MARKETING_CONSENT_NOTICE = {
  title: '마케팅 정보 수신 동의',
  summary: '신상품·이벤트·할인 혜택 같은 광고성 정보를 동의한 수단으로 보내 드려요. 동의하지 않아도 가입과 구매에 불이익이 없고, 주문·배송 같은 거래 안내는 동의와 관계없이 보내 드려요.',
  sms: 'SMS는 휴대폰 번호가 등록된 경우에만 보내 드려요.',
  change: '설정에서 수단별로 언제든 바꿀 수 있어요.',
  /* 인앱 알림함의 마케팅 소식은 수단과 무관한 파생값(하나라도 동의 = true)을 따른다. */
  inApp: '알림함의 마케팅 소식은 이메일·SMS 중 하나라도 수신에 동의하면 받아요. 두 수단을 모두 끄면 알림함 마케팅 소식도 받지 않아요.',
} as const;

/*
 * 카카오톡을 더한 안내(marketing-channels-v2, 1014-010). 카카오톡 채널 스위치가 켜졌을 때만 화면에 나온다.
 * 문구를 바꾸면 버전을 올리고 DB가 받는 버전 목록(customer_marketing_consents notice_version check)도 함께 바꾼다.
 */
export const MARKETING_CONSENT_NOTICE_WITH_KAKAO = {
  title: MARKETING_CONSENT_NOTICE.title,
  summary: MARKETING_CONSENT_NOTICE.summary,
  sms: MARKETING_CONSENT_NOTICE.sms,
  kakao: '카카오톡은 ICONS 카카오톡 채널 메시지로 보내 드려요. 채널을 차단해도 받지 않아요.',
  change: MARKETING_CONSENT_NOTICE.change,
  inApp: '알림함의 마케팅 소식은 이메일·SMS·카카오톡 중 하나라도 수신에 동의하면 받아요. 세 수단을 모두 끄면 알림함 마케팅 소식도 받지 않아요.',
} as const;

/** 수단 목록에 맞는 안내와 버전. 카카오톡이 없으면 예전 v1 그대로다. */
export function marketingConsentNoticeFor(channels: readonly MarketingChannel[]) {
  return channels.includes('kakao')
    ? { notice: MARKETING_CONSENT_NOTICE_WITH_KAKAO, version: MARKETING_CONSENT_NOTICE_VERSION_WITH_KAKAO }
    : { notice: { ...MARKETING_CONSENT_NOTICE, kakao: '' }, version: MARKETING_CONSENT_NOTICE_VERSION };
}

export interface MarketingChannelConsent {
  agreed: boolean;
  agreedAt: string | null;
  withdrawnAt: string | null;
  noticeVersion: string;
  source: MarketingConsentRecordSource;
}

export interface MarketingConsentState {
  marketing: boolean;
  email: MarketingChannelConsent | null;
  sms: MarketingChannelConsent | null;
  /** 카카오톡 수신 동의(1014-010). 기록이 없거나 예전 응답이면 null(파서는 늘 채운다). */
  kakao?: MarketingChannelConsent | null;
}

/** 수단별 선택. kakao가 없으면 카카오톡 줄을 그리지 않은 저장이다 — 그때는 예전(v1) 저장 경로를 탄다. */
export interface MarketingChannelChoices {
  email: boolean;
  sms: boolean;
  kakao?: boolean;
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || transactionInstant(value);
}

function parseChannel(value: unknown): MarketingChannelConsent | null | undefined {
  if (value === null) return null;
  if (!transactionRecord(value) || typeof value.agreed !== 'boolean' || typeof value.noticeVersion !== 'string'
    || !nullableInstant(value.agreedAt) || !nullableInstant(value.withdrawnAt)
    || !MARKETING_CONSENT_SOURCES.includes(value.source as MarketingConsentRecordSource)
    || value.agreed !== (value.agreedAt !== null)) return undefined;
  return { agreed: value.agreed, agreedAt: value.agreedAt, withdrawnAt: value.withdrawnAt, noticeVersion: value.noticeVersion,
    source: value.source as MarketingConsentRecordSource };
}

/** RPC 응답을 검증한다. 모양이 다르면 null — 화면은 기본값(미동의)으로 그린다. */
export function parseMarketingConsentState(value: unknown): MarketingConsentState | null {
  if (!transactionRecord(value) || typeof value.marketing !== 'boolean') return null;
  const email = parseChannel(value.email);
  const sms = parseChannel(value.sms);
  const kakao = value.kakao === undefined ? null : parseChannel(value.kakao);
  if (email === undefined || sms === undefined || kakao === undefined) return null;
  if (value.marketing !== Boolean(email?.agreed || sms?.agreed || kakao?.agreed)) return null;
  return { marketing: value.marketing, email, sms, kakao };
}

/** 화면의 처음 선택. 카카오톡 줄을 그릴 때만 kakao를 채운다. */
export function marketingChannelChoices(
  state: MarketingConsentState | null | undefined,
  options: { withKakao?: boolean } = {},
): MarketingChannelChoices {
  const choices: MarketingChannelChoices = { email: state?.email?.agreed === true, sms: state?.sms?.agreed === true };
  if (options.withKakao) choices.kakao = state?.kakao?.agreed === true;
  return choices;
}

/**
 * 카카오톡 줄을 그릴지. 카카오톡 채널 스위치가 켜졌거나, 스위치가 꺼졌어도 회원이 이미 카카오톡 수신에 동의해 있으면
 * 그린다 — 동의 철회는 언제든 할 수 있어야 한다(정보통신망법 제50조).
 */
export function marketingKakaoVisible(kakaoChannelOn: boolean, state: MarketingConsentState | null | undefined): boolean {
  return kakaoChannelOn || state?.kakao?.agreed === true;
}

/**
 * 폼의 수단별 선택. 화면이 카카오톡 줄을 그린 저장이면(표시 필드) kakao를 읽는다. 카카오톡 채널 스위치가 꺼져 있으면
 * 새 동의는 받지 않고 철회만 받는다 — 동의(true)는 버리고 예전 두 수단 저장으로 처리한다.
 */
export function readMarketingChannelChoices(formData: FormData, options: { kakaoChannelOn?: boolean } = {}): MarketingChannelChoices {
  const choices: MarketingChannelChoices = {
    email: formData.get(MARKETING_CHANNEL_FIELDS.email) === 'on',
    sms: formData.get(MARKETING_CHANNEL_FIELDS.sms) === 'on',
  };
  if (formData.get(MARKETING_KAKAO_OFFERED_FIELD) === '1') {
    const kakao = formData.get(MARKETING_CHANNEL_FIELDS.kakao) === 'on';
    if (!kakao || options.kakaoChannelOn) choices.kakao = kakao;
  }
  return choices;
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
  const channels = choices.kakao === undefined ? MARKETING_CHANNELS : MARKETING_CHANNELS_WITH_KAKAO;
  const parts = channels.map((channel) => `${MARKETING_CHANNEL_LABELS[channel]} ${choices[channel] ? '수신 동의' : '수신 거부'}`);
  const inApp = choices.email || choices.sms || choices.kakao ? '' : ' · 알림함 마케팅 소식도 받지 않아요';
  return `ICONS 마케팅 정보 수신 설정을 저장했어요 · ${parts.join(' · ')} · ${formatMarketingConsentDate(at)} 처리${inApp}`;
}

/**
 * 설정 화면의 동의 표시. 이관 동의(source legacy)는 동의 시각이 기록된 적이 없어 날짜 대신
 * "기존 동의(기록 전)"로 말한다 — 원장의 agreed_at은 2년 재확인용 보수적 하한일 뿐 실제 동의일이 아니다.
 */
export function marketingChannelConsentLabel(consent: MarketingChannelConsent | null | undefined): string | null {
  if (!consent?.agreed || !consent.agreedAt) return null;
  if (consent.source === 'legacy') return '기존 동의(기록 전)';
  return `${formatMarketingConsentDate(consent.agreedAt)} 동의`;
}
