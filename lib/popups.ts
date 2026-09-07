/*
 * 온라인 팝업 — 순수 모듈 (설계서 v2 §1-8).
 *
 * 판정은 전부 DB 가 한다(`popup_snapshot`). 여기서는 **화면이 쓰는 어휘**만 정한다 —
 * 앱이 다시 판정하면 서버 시계와 브라우저 시계가 갈라져 「열렸는데 안 열린」 팝업이 생긴다.
 */

export const POPUPS_CACHE_TAG = 'popups';

export function popupCacheTag(popupId: string): string {
  return `popup:${popupId}`;
}

export const POPUP_STATUSES = [
  { value: 'draft', label: '초안' },
  { value: 'published', label: '게시' },
  { value: 'paused', label: '일시정지' },
  { value: 'ended', label: '종료' },
] as const;
export type PopupStatus = (typeof POPUP_STATUSES)[number]['value'];

/** 표시 상태 — 저장하지 않고 조회 시 파생한다. 운영자 의사가 시각보다 세다. */
export const POPUP_DISPLAY_STATE_LABELS: Record<string, string> = {
  archived: '보관',
  draft: '초안',
  paused: '일시정지',
  ended: '종료',
  upcoming: '예정',
  live: '진행중',
};

export const POPUP_SALE_MODES = [
  { value: 'hidden', label: '미공개' },
  { value: 'teaser', label: '노출만 (구매 불가)' },
  { value: 'preorder', label: '사전예약' },
  { value: 'on_sale', label: '판매' },
  { value: 'sellout', label: '잔여 소진' },
  { value: 'closed', label: '종료' },
] as const;
export type PopupSaleMode = (typeof POPUP_SALE_MODES)[number]['value'];

export const POPUP_SALE_MODE_LABELS: Record<string, string> = Object.fromEntries(
  POPUP_SALE_MODES.map((mode) => [mode.value, mode.label]),
);

/** 존 = 모듈 유형 6종. 한 존은 한 유형만 갖는다(모듈 순수성). */
export const POPUP_ZONE_KINDS = [
  { value: 'info', label: '정보성' },
  { value: 'record', label: '기록' },
  { value: 'experience', label: '체험' },
  { value: 'commerce', label: '커머스' },
  { value: 'event', label: '이벤트' },
  { value: 'community', label: '커뮤니티' },
] as const;

export const POPUP_ZONE_KIND_LABELS: Record<string, string> = Object.fromEntries(
  POPUP_ZONE_KINDS.map((kind) => [kind.value, kind.label]),
);

export const POPUP_TARGET_TYPES = [
  { value: 'good', label: '굿즈' },
  { value: 'campaign', label: '기획전' },
  { value: 'event', label: '이벤트' },
  { value: 'game', label: '게임' },
  { value: 'ticket_type', label: '티켓 회차' },
  { value: 'card_pool', label: '카드풀' },
  { value: 'curation', label: '큐레이션' },
] as const;

export const POPUP_TARGET_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  POPUP_TARGET_TYPES.map((type) => [type.value, type.label]),
);

export interface PopupPhaseView {
  key: string;
  label: string;
  startsAt: string;
  endsAt: string;
  /** 이 시각 기준으로 진행 중인가. DB 가 판정한 값이다. */
  on: boolean;
  done: boolean;
}

export interface PopupZoneView {
  code: string;
  kind: string;
  name: string;
  door: string | null;
  config: Record<string, unknown>;
}

export interface PopupLinkView {
  targetType: string;
  targetId: string;
  zoneCode: string | null;
  mode: string;
}

export interface PopupSnapshot {
  popup: {
    id: string;
    ipId: string;
    title: string;
    subtitle: string | null;
    status: string;
    startsAt: string;
    endsAt: string;
    heroImagePath: string | null;
    cardImagePath: string | null;
  };
  displayState: string;
  /** 판정에 쓴 서버 시각. 화면은 자기 시계로 다시 판정하지 않는다. */
  serverNow: string;
  asOf: string;
  currentPhase: string | null;
  phases: PopupPhaseView[];
  zones: PopupZoneView[];
  links: PopupLinkView[];
}

/** 기간 한 줄. 저장은 UTC instant, 표시는 언제나 서울 시각이다. */
export function formatPopupPeriod(startsAt: string, endsAt: string): string {
  const format = (value: string) => {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(time));
  };
  return `${format(startsAt)} ~ ${format(endsAt)}`;
}

/**
 * 페이즈 진행률(0~1). 시작 전 0, 끝난 뒤 1.
 * 판정이 아니라 **표시**다 — 어느 페이즈인지는 DB 가 이미 말해 준다.
 */
export function phaseProgress(phase: PopupPhaseView, asOf: string): number {
  const start = Date.parse(phase.startsAt);
  const end = Date.parse(phase.endsAt);
  const now = Date.parse(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now)) return 0;
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}
