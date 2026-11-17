import { isSafeInternalLink } from './home-catalog';

/* 캠페인 노출 설정(스펙 C §2.8, §4.3) — EVENT·POP-UP 구분, POP-UP 장소, 카드·배너 바로가기.
   DB 표 `campaign_presentations`와 `admin_save_campaign_presentation`의 계약을 순수 TS 로 옮긴 모듈이다.
   고객 화면 로더·어드민 저장 액션·패널이 같은 정의를 import 한다. DB 가 같은 검증을 한 번 더 한다(22023). */

export const CAMPAIGN_POPUP_MODES = ['online', 'offline', 'hybrid'] as const;
export type CampaignPopupMode = typeof CAMPAIGN_POPUP_MODES[number];

export const CAMPAIGN_POPUP_MODE_LABELS: Record<CampaignPopupMode, string> = {
  online: '온라인',
  offline: '오프라인',
  hybrid: '온·오프라인',
};

export const CAMPAIGN_POPUP_LOCATION_MAX_LENGTH = 120;
export const CAMPAIGN_CARD_LINK_MAX_LENGTH = 300;

export interface CampaignPresentation {
  /** 값이 있으면 POP-UP 캠페인이다. null 이면 EVENT 에 보인다. */
  popupMode: CampaignPopupMode | null;
  /** POP-UP 일 때만 쓴다(고객 화면 기간 옆 한 줄). popupMode 가 null 이면 항상 null. */
  popupLocation: string | null;
  /** 사이트 안 경로(`/`로 시작). 있으면 EVENT·POP-UP 카드와 배너가 캠페인 랜딩 대신 그곳으로 바로 간다. */
  cardLinkPath: string | null;
}

export function isCampaignPopupMode(value: unknown): value is CampaignPopupMode {
  return typeof value === 'string' && (CAMPAIGN_POPUP_MODES as readonly string[]).includes(value);
}

/* DB 의 char_length 와 같게 코드 포인트로 센다. */
function characterLength(value: string): number {
  return Array.from(value).length;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
}

/** DB 행(`campaign_presentations`의 popup_mode·popup_location·card_link_path)을 값으로 읽는다.
 *  형식이 DB 제약과 어긋나면 null — 호출 쪽은 EVENT 쪽 캠페인으로 다룬다(화면을 깨지 않는다).
 *  PostgREST 임베드가 한 줄 배열로 오는 경우도 받는다(빈 배열은 행 없음 = null). */
export function parseCampaignPresentationRow(row: unknown): CampaignPresentation | null {
  const source = Array.isArray(row) ? (row.length === 1 ? row[0] : null) : row;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const record = source as Record<string, unknown>;

  const rawMode = nullableText(record.popup_mode);
  const rawLocation = nullableText(record.popup_location);
  const rawLink = nullableText(record.card_link_path);
  if (rawMode === undefined || rawLocation === undefined || rawLink === undefined) return null;

  if (rawMode !== null && !isCampaignPopupMode(rawMode)) return null;
  if (rawLocation !== null) {
    if (rawMode === null) return null;
    const length = characterLength(rawLocation);
    if (length < 1 || length > CAMPAIGN_POPUP_LOCATION_MAX_LENGTH) return null;
  }
  if (rawLink !== null && (characterLength(rawLink) > CAMPAIGN_CARD_LINK_MAX_LENGTH || !isSafeInternalLink(rawLink))) return null;

  return { popupMode: rawMode, popupLocation: rawLocation, cardLinkPath: rawLink };
}

export type CampaignPresentationField = 'popupMode' | 'popupLocation' | 'cardLinkPath';
export type CampaignPresentationErrors = Partial<Record<CampaignPresentationField, string>>;

export const CAMPAIGN_PRESENTATION_MESSAGES = {
  popupMode: 'POP-UP에 싣는 방식을 다시 골라주세요.',
  popupLocation: `장소는 ${CAMPAIGN_POPUP_LOCATION_MAX_LENGTH}자 이하로 입력해주세요.`,
  cardLinkLength: `바로가기 주소는 ${CAMPAIGN_CARD_LINK_MAX_LENGTH}자 이하로 입력해주세요.`,
  cardLinkFormat: '사이트 안 주소(/로 시작)만 넣을 수 있습니다.',
  cardLinkWhitespace: '주소에 띄어쓰기를 넣을 수 없습니다.',
} as const;

/** 어드민 폼 입력(빈 문자열 = 비움)을 저장 값으로 정리하고 검증한다. 앞뒤 공백은 지우고, 빈 값은 null 이다.
 *  POP-UP 에 싣지 않으면(popupMode 가 비면) 장소는 무시하고 비운다. 링크는 `isSafeInternalLink`(사이트 안 경로만) + 300자 + 공백 불가. */
export function normalizeCampaignPresentationInput(input: {
  popupMode: string;
  popupLocation: string;
  cardLinkPath: string;
}): { ok: true; value: CampaignPresentation } | { ok: false; errors: CampaignPresentationErrors } {
  const errors: CampaignPresentationErrors = {};

  const mode = input.popupMode.trim();
  let popupMode: CampaignPopupMode | null = null;
  if (mode !== '') {
    if (isCampaignPopupMode(mode)) popupMode = mode;
    else errors.popupMode = CAMPAIGN_PRESENTATION_MESSAGES.popupMode;
  }

  const location = input.popupLocation.trim();
  let popupLocation: string | null = null;
  if (popupMode !== null && location !== '') {
    if (characterLength(location) > CAMPAIGN_POPUP_LOCATION_MAX_LENGTH) errors.popupLocation = CAMPAIGN_PRESENTATION_MESSAGES.popupLocation;
    else popupLocation = location;
  }

  const link = input.cardLinkPath.trim();
  let cardLinkPath: string | null = null;
  if (link !== '') {
    if (characterLength(link) > CAMPAIGN_CARD_LINK_MAX_LENGTH) errors.cardLinkPath = CAMPAIGN_PRESENTATION_MESSAGES.cardLinkLength;
    /* 앞뒤 공백은 위에서 지웠으므로 남은 공백은 주소 한가운데다. DB 는 공백 든 주소를 22023 으로 거절하는데 그 문구는
       "/로 시작"이라 엉뚱하니, 화면에서 먼저 전용 문구로 막는다(모든 공백 문자: 스페이스·탭·줄바꿈·NBSP 등). */
    else if (/\s/u.test(link)) errors.cardLinkPath = CAMPAIGN_PRESENTATION_MESSAGES.cardLinkWhitespace;
    else if (!isSafeInternalLink(link)) errors.cardLinkPath = CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat;
    else cardLinkPath = link;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { popupMode, popupLocation, cardLinkPath } };
}
