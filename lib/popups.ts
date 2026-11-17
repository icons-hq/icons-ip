import { CAMPAIGN_POPUP_MODE_LABELS } from './campaign-presentation';
import { campaignPeriodLabel, type CampaignSummary } from './campaigns';
import type { FandomEvent } from './data';
import { imageBg } from './media';

/* POP-UP 목록의 항목과 합치기 규칙 (Figma 2026-11-12, 스펙 C §2.6).
 *
 * 순수 모듈이다 — DB 도 supabase 클라이언트도 모른다. 서버 로더(`lib/popups.server.ts`)가 두 원천(오프라인 팝업 =
 * 예매 도메인 `events`, POP-UP 캠페인 = 노출 설정에 'POP-UP에 싣기'를 고른 캠페인)을 읽어 이 함수에 넘긴다.
 * 어느 쪽이든 카드 한 장이 같은 모양(`PopupItem`)이라 화면은 원천을 가리지 않는다. */

/** POP-UP 목록 화면 경로. GNB 가 이 값을 쓴다(`PATHS.popups`와 같다 — 통합 때 그쪽을 원천으로 맞춘다). */
const POPUPS_PATH = '/popups';
const OFFLINE_POPUPS_PATH = '/offline-popups';

export function popupsHref(): string {
  return POPUPS_PATH;
}

/** POP-UP 캠페인 상세(`/popups/<id>`). 오프라인 팝업 상세는 `offlinePopupDetailHref`다. */
export function popupDetailHref(id: string): string {
  return `${POPUPS_PATH}/${encodeURIComponent(id)}`;
}

/** 오프라인 팝업 상세(`/offline-popups/<id>`, 예매 도메인). */
export function offlinePopupDetailHref(id: string): string {
  return `${OFFLINE_POPUPS_PATH}/${encodeURIComponent(id)}`;
}

/** 목록에 싣는 최대 개수. */
export const POPUP_LIST_LIMIT = 60;

/** 오프라인 팝업 모드 값(`events.mode`) — 이 값만 POP-UP 에 싣는다(온라인은 POP-UP 캠페인으로 등록). */
const OFFLINE_EVENT_MODE = '오프라인';
const OFFLINE_MODE_LABEL = CAMPAIGN_POPUP_MODE_LABELS.offline;

export const POPUP_UPCOMING_BADGE = '오픈 예정';

export const POPUP_EMPTY_TEXT = {
  title: '진행 중인 POP-UP이 없어요',
  description: '새 POP-UP이 열리면 이 자리에서 가장 먼저 알려 드릴게요.',
  action: '홈으로 가기',
} as const;

export type PopupSource = 'event' | 'campaign';
export type PopupPhase = 'ongoing' | 'upcoming';

export interface PopupItem {
  /** 원천을 포함한 유일 키(`event:<id>` · `campaign:<id>`). */
  key: string;
  source: PopupSource;
  id: string;
  title: string;
  href: string;
  /** CSS background 값(이미지 레이어 또는 그라데이션). 없으면 회색 면. */
  imageBg: string | null;
  phase: PopupPhase;
  /** 정렬용 시작 시각(ms). 모르면 null. */
  startsAtMs: number | null;
  /** 카드 메타 한 줄 — `{온라인|오프라인|온·오프라인} · {장소?} · {기간}`. */
  meta: string;
}

/** 메타 한 줄 — 비어 있는 조각은 건너뛴다. */
export function popupMetaLine(parts: { modeLabel: string; location?: string | null; period?: string | null }): string {
  return [parts.modeLabel, parts.location, parts.period]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '')
    .join(' · ');
}

/** 예매 도메인 `events`의 시각(로더가 별도 쿼리로 읽어 온다). 없는 값은 null. */
export interface PopupEventTimes {
  startsAt: string | null;
  endsAt: string | null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** 운영자가 지정한 오프라인 팝업 상태 → 진행/예정. 종료·모르는 값은 null(목록에서 뺀다). */
function eventPhase(status: string): PopupPhase | null {
  if (status === '진행중' || status === '예매중') return 'ongoing';
  if (status === '예정') return 'upcoming';
  return null;
}

/**
 * 오프라인 팝업의 기간 표기 — POP-UP 캠페인과 같은 형식(`campaignPeriodLabel`: `2026.11.14 – 12.7`, 같은 해면 뒤 연도 생략)이다.
 * 시작·끝 시각을 둘 다 읽었을 때만 그렇게 만든다. 못 읽었으면(목업 카탈로그·끝 시각 없음) 카탈로그가 만든 날짜 표기(`event.date`)로 떨어진다.
 */
function eventPeriodLabel(event: FandomEvent, times: PopupEventTimes | undefined): string {
  if (times?.startsAt && times.endsAt && parseTime(times.startsAt) !== null && parseTime(times.endsAt) !== null) {
    return campaignPeriodLabel(times.startsAt, times.endsAt);
  }
  return event.date;
}

/**
 * 오프라인 팝업(`events`) → 항목.
 * 오프라인 모드만, 상태는 진행중·예매중·예정만, 끝 시각이 이미 지난 것은 뺀다(끝 시각을 모르면 상태를 믿는다).
 */
export function popupItemsFromEvents(
  events: readonly FandomEvent[],
  timesById: ReadonlyMap<string, PopupEventTimes>,
  now: number,
): PopupItem[] {
  return events.flatMap((event) => {
    if (event.mode !== OFFLINE_EVENT_MODE) return [];
    const phase = eventPhase(event.status);
    if (!phase) return [];

    const times = timesById.get(event.id);
    const endsAt = parseTime(times?.endsAt);
    if (endsAt !== null && endsAt <= now) return [];

    return [{
      key: `event:${event.id}`,
      source: 'event' as const,
      id: event.id,
      title: event.title,
      href: offlinePopupDetailHref(event.id),
      imageBg: event.img || null,
      phase,
      startsAtMs: parseTime(times?.startsAt),
      meta: popupMetaLine({ modeLabel: OFFLINE_MODE_LABEL, location: event.loc, period: eventPeriodLabel(event, times) }),
    }];
  });
}

/**
 * POP-UP 캠페인 → 항목.
 * 게시됐고 노출 설정에 POP-UP 방식이 있고, 표시 상태가 진행중·예정인 것만. 카드는 바로가기가 있으면 그곳으로 간다.
 */
export function popupItemsFromCampaigns(campaigns: readonly CampaignSummary[]): PopupItem[] {
  return campaigns.flatMap((campaign) => {
    const presentation = campaign.presentation;
    const mode = presentation?.popupMode;
    if (!presentation || !mode) return [];
    if (campaign.status !== 'published') return [];
    if (campaign.displayState !== 'ongoing' && campaign.displayState !== 'upcoming') return [];

    const image = campaign.cardImagePath ?? campaign.bannerImagePath ?? campaign.heroImagePath ?? null;
    return [{
      key: `campaign:${campaign.id}`,
      source: 'campaign' as const,
      id: campaign.id,
      title: campaign.title,
      href: presentation.cardLinkPath ?? popupDetailHref(campaign.id),
      /* 로더가 Storage 경로를 공개 URL 로 바꿔 두었다 — 카드 배경은 CSS 값이다. */
      imageBg: image ? imageBg(image) : null,
      phase: campaign.displayState,
      startsAtMs: parseTime(campaign.startsAt),
      meta: popupMetaLine({
        modeLabel: CAMPAIGN_POPUP_MODE_LABELS[mode],
        location: presentation.popupLocation,
        period: campaignPeriodLabel(campaign.startsAt, campaign.endsAt),
      }),
    }];
  });
}

/**
 * 두 원천을 한 목록으로 — 진행 중(시작 최신순) → 오픈 예정(시작 이른순), 최대 `POPUP_LIST_LIMIT`개.
 * 시작 시각을 모르는 항목은 각 그룹의 맨 뒤다. 같은 시각이면 원천·id 순서로 고정한다(렌더마다 순서가 흔들리지 않게).
 */
export function mergePopupItems(...sources: readonly (readonly PopupItem[])[]): PopupItem[] {
  const items = sources.flat();
  const tieBreak = (a: PopupItem, b: PopupItem) => a.key.localeCompare(b.key);

  const ongoing = items
    .filter((item) => item.phase === 'ongoing')
    .sort((a, b) => (b.startsAtMs ?? Number.NEGATIVE_INFINITY) - (a.startsAtMs ?? Number.NEGATIVE_INFINITY) || tieBreak(a, b));
  const upcoming = items
    .filter((item) => item.phase === 'upcoming')
    .sort((a, b) => (a.startsAtMs ?? Number.POSITIVE_INFINITY) - (b.startsAtMs ?? Number.POSITIVE_INFINITY) || tieBreak(a, b));

  return [...ongoing, ...upcoming].slice(0, POPUP_LIST_LIMIT);
}
