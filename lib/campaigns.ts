/* 캠페인 허브·랜딩의 표시 파생 (S8 #330 · R-06 §1·§2 · DESIGN §6 campaign-hub/landing).
 *
 * 순수 모듈이다 — DB도 supabase 클라이언트도 모른다. 서버 로더(lib/campaigns.server.ts)와
 * 화면이 같은 규칙으로 상태·기간·본문 블록을 읽게 만드는 것이 유일한 목적이다.
 *
 * 기간 라벨과 상태 뱃지는 레퍼런스에 없던 요소다(R-06 §1.4 "기간 라벨·진행중/종료 상태
 * 뱃지 없음", §13-2가 그 결함을 지적한다). DESIGN §6 campaign-hub가 이를 의도적 보완으로
 * 못 박았으므로 여기서 두 파생을 모두 소유한다. */

export type CampaignKind = 'event' | 'drop';

/** DB `campaigns.status`. draft는 RLS가 비운영자에게 감추므로 표시 계약에는 없다. */
export type CampaignStatus = 'published' | 'ended';

/** 화면이 뱃지·참여 가능 여부를 정하는 파생 상태. DB 컬럼이 아니다. */
export type CampaignDisplayState = 'upcoming' | 'ongoing' | 'ended';

/* ------------------------------------------------------------------
   본문 블록 — private.validate_campaign_sections(20260831100000)와 1:1
   ------------------------------------------------------------------
   키 이름을 DB jsonb 그대로 둔다. 로더에서 camelCase로 갈아끼우면 검증 규칙과
   파서가 서로 다른 이름을 보게 되고, 어드민이 블록을 하나 추가할 때 두 곳을
   맞춰야 한다. anchor는 모든 블록의 선택 키다(상세 페이지 목차 링크). */

interface CampaignSectionBase {
  anchor?: string;
}

export interface CampaignIntroSection extends CampaignSectionBase {
  type: 'intro';
  copy: string;
}

export interface CampaignImageSection extends CampaignSectionBase {
  type: 'image';
  image_path: string;
  alt: string;
}

export interface CampaignTextSection extends CampaignSectionBase {
  type: 'text';
  heading?: string;
  body: string;
}

export interface CampaignAttendanceSection extends CampaignSectionBase {
  type: 'attendance';
}

export interface CampaignExchangeSection extends CampaignSectionBase {
  type: 'exchange';
  offer_id: string;
}

export interface CampaignCouponSection extends CampaignSectionBase {
  type: 'coupon';
  coupon_code: string;
  description?: string;
}

export interface CampaignGoodsSection extends CampaignSectionBase {
  type: 'goods';
  good_ids: string[];
}

export interface CampaignNoticeSection extends CampaignSectionBase {
  type: 'notice';
  items: string[];
}

export type CampaignSection =
  | CampaignIntroSection
  | CampaignImageSection
  | CampaignTextSection
  | CampaignAttendanceSection
  | CampaignExchangeSection
  | CampaignCouponSection
  | CampaignGoodsSection
  | CampaignNoticeSection;

export interface CampaignSummary {
  id: string;
  kind: CampaignKind;
  title: string;
  subtitle: string | null;
  /* 이미지 주소. DB 컬럼명(card_image_path)을 따르지만, 로더가 Storage 경로를
     공개 URL로 이미 바꿔서 넘긴다 — 화면은 그대로 background 에 쓴다. */
  cardImagePath: string | null;
  bannerImagePath: string | null;
  /** null이면 허브 배너가 아니다. 값이 있으면 오름차순이 배너 순서다. */
  featuredOrder: number | null;
  startsAt: string;
  endsAt: string;
  status: CampaignStatus;
  displayState: CampaignDisplayState;
}

export interface CampaignDetailData extends CampaignSummary {
  heroImagePath: string | null;
  sections: CampaignSection[];
}

const STATE_LABELS: Record<CampaignDisplayState, string> = {
  ongoing: '진행중',
  upcoming: '예정',
  ended: '종료',
};

/* 카드 좌상단 유형 뱃지는 색이 아니라 텍스트로 구분한다(R-06 §1.4) — 검정 bg·흰 글자
   한 벌이라 색맹 사용자에게도 유형이 전달된다. */
const KIND_LABELS: Record<CampaignKind, string> = {
  event: 'EVENT',
  drop: 'DROP',
};

export function isCampaignKind(value: unknown): value is CampaignKind {
  return value === 'event' || value === 'drop';
}

export function campaignStateLabel(state: CampaignDisplayState): string {
  return STATE_LABELS[state];
}

export function campaignKindLabel(kind: CampaignKind): string {
  return KIND_LABELS[kind];
}

/**
 * 표시 상태.
 *
 * 운영자가 내린 `status = 'ended'`가 시각보다 세다 — 기간이 남았는데 조기 종료한
 * 캠페인을 "진행중"으로 그리면 참여 버튼이 살아 있는 것처럼 보인다.
 */
export function campaignDisplayState(
  campaign: Pick<CampaignSummary, 'status' | 'startsAt' | 'endsAt'>,
  now: number = Date.now(),
): CampaignDisplayState {
  if (campaign.status === 'ended') return 'ended';

  const endsAt = Date.parse(campaign.endsAt);
  if (Number.isFinite(endsAt) && now > endsAt) return 'ended';

  const startsAt = Date.parse(campaign.startsAt);
  if (Number.isFinite(startsAt) && now < startsAt) return 'upcoming';

  return 'ongoing';
}

/* 기간은 한국 사용자에게 KST로 읽힌다. 서버(UTC)·브라우저(로컬) 어디서 그리든
   같은 날짜가 나와야 하므로 타임존을 명시적으로 고정한다. */
const KST_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function kstDateParts(value: string): DateParts | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;

  const parts = KST_DATE_PARTS.formatToParts(new Date(time));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) return null;

  return { year, month, day };
}

export const CAMPAIGN_PERIOD_UNKNOWN = '기간 미정';

/**
 * "2026.8.7 – 8.31" 꼴 기간 라벨.
 *
 * 같은 해면 뒤쪽 연도를 생략한다 — 대부분의 캠페인이 한 달 안에 끝나서 연도를 두 번
 * 쓰면 라벨이 카드 폭을 잡아먹는다. 해가 넘어가면 둘 다 적는다.
 */
export function campaignPeriodLabel(startsAt: string, endsAt: string): string {
  const start = kstDateParts(startsAt);
  const end = kstDateParts(endsAt);
  if (!start || !end) return CAMPAIGN_PERIOD_UNKNOWN;

  const head = `${start.year}.${start.month}.${start.day}`;
  const tail = start.year === end.year
    ? `${end.month}.${end.day}`
    : `${end.year}.${end.month}.${end.day}`;

  return `${head} – ${tail}`;
}

const DISPLAY_STATE_ORDER: Record<CampaignDisplayState, number> = {
  ongoing: 0,
  upcoming: 1,
  ended: 2,
};

/**
 * 허브 목록 정렬 — 진행중 → 예정 → 종료, 그룹 안에서는 시작일 내림차순.
 *
 * 레퍼런스는 종료 이벤트를 시각 구분 없이 하단으로 미는 아카이브형이라 "지금 참여
 * 가능한 것"이 목록 어디에 있는지 알 수 없었다(R-06 §13-2). 그룹을 먼저 나눈다.
 */
export function orderCampaignsForHub<T extends Pick<CampaignSummary, 'displayState' | 'startsAt'>>(
  campaigns: readonly T[],
): T[] {
  return [...campaigns].sort((a, b) => {
    const group = DISPLAY_STATE_ORDER[a.displayState] - DISPLAY_STATE_ORDER[b.displayState];
    if (group !== 0) return group;
    return (Date.parse(b.startsAt) || 0) - (Date.parse(a.startsAt) || 0);
  });
}

/* ------------------------------------------------------------------
   본문 파서
   ------------------------------------------------------------------ */

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function parseSection(raw: unknown): CampaignSection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const entry = raw as Record<string, unknown>;
  const anchor = optionalString(entry.anchor);
  const base = anchor ? { anchor } : {};

  switch (entry.type) {
    case 'intro': {
      const copy = requiredString(entry.copy);
      return copy ? { ...base, type: 'intro', copy } : null;
    }
    case 'image': {
      const imagePath = requiredString(entry.image_path);
      const alt = requiredString(entry.alt);
      return imagePath && alt ? { ...base, type: 'image', image_path: imagePath, alt } : null;
    }
    case 'text': {
      const body = requiredString(entry.body);
      if (!body) return null;
      const heading = optionalString(entry.heading);
      return { ...base, type: 'text', body, ...(heading ? { heading } : {}) };
    }
    case 'attendance':
      return { ...base, type: 'attendance' };
    case 'exchange': {
      const offerId = requiredString(entry.offer_id);
      return offerId ? { ...base, type: 'exchange', offer_id: offerId } : null;
    }
    case 'coupon': {
      const couponCode = requiredString(entry.coupon_code);
      if (!couponCode) return null;
      const description = optionalString(entry.description);
      return {
        ...base,
        type: 'coupon',
        coupon_code: couponCode,
        ...(description ? { description } : {}),
      };
    }
    case 'goods': {
      const goodIds = stringArray(entry.good_ids);
      return goodIds.length ? { ...base, type: 'goods', good_ids: goodIds } : null;
    }
    case 'notice': {
      const items = stringArray(entry.items);
      return items.length ? { ...base, type: 'notice', items } : null;
    }
    default:
      return null;
  }
}

/**
 * 관대한 파서 — 배열이 아니거나, 원소가 비정형이거나, 모르는 type이면 조용히 건너뛴다.
 *
 * 저장 시점 검증은 DB(private.validate_campaign_sections)가 이미 했다. 그럼에도 관대한
 * 이유는 반대 방향이다: 나중에 추가될 블록 종류를 아직 모르는 구버전 화면이 상세 페이지
 * 전체를 500으로 떨어뜨리면 안 된다. 아는 블록만 그린다.
 */
export function parseCampaignSections(raw: unknown): CampaignSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const section = parseSection(entry);
    return section ? [section] : [];
  });
}

/* ------------------------------------------------------------------
   앵커 내브
   ------------------------------------------------------------------ */

export interface CampaignAnchor {
  id: string;
  label: string;
}

/* anchor 문자열은 운영자가 자유롭게 넣는 1~20자다. 그 값을 DOM id 로 그대로 쓰면
   공백·특수문자가 섞인 순간 `#앵커` 링크가 깨진다 — id 는 순서에서 만들고
   운영자 문자열은 라벨로만 쓴다. */
export function campaignSectionDomId(index: number): string {
  return `campaign-section-${index}`;
}

export function campaignAnchors(sections: readonly { anchor?: string }[]): CampaignAnchor[] {
  return sections.flatMap((section, index) => (
    section.anchor ? [{ id: campaignSectionDomId(index), label: section.anchor }] : []
  ));
}
