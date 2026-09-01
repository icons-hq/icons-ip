import type { FandomEvent } from './data';

export const ALL_IPS = 'all';
export const ALL_MODES = '전체';
export const ALL_STATUSES = '전체';

const ONLINE_MODE = '온라인';
const MODE_ORDER = [ONLINE_MODE, '오프라인'];
// 예매 의도가 큰 순서로 노출한다: 지금 입장 가능한 진행중 → 예매중 → 예정.
const STATUS_PRIORITY = ['진행중', '예매중', '예정'];

export interface EventFilter {
  ipId: string;
  mode: string;
  status: string;
}

function statusRank(status: string): number {
  const index = STATUS_PRIORITY.indexOf(status);
  return index === -1 ? STATUS_PRIORITY.length : index;
}

export function eventModeOptions(events: FandomEvent[]): string[] {
  const present = new Set(events.map((event) => event.mode));
  return MODE_ORDER.filter((mode) => present.has(mode));
}

export function eventStatusOptions(events: FandomEvent[]): string[] {
  const present = new Set(events.map((event) => event.status));
  return STATUS_PRIORITY.filter((status) => present.has(status));
}

/**
 * 오프라인 팝업 표면이 다룰 이벤트만 남긴다.
 *
 * 카탈로그의 `events`는 온·오프라인을 한 테이블에 담는데, `/offline-popups`는 그중
 * 오프라인만 맡는 표면이다 — 온라인 팝업의 정본 자리는 IP 관이다(CONTEXT.md).
 * 섞여 들어오면 "오프라인 팝업"이라는 제목이 거짓이 되고, 현장 입장·장소 안내를
 * 붙일 수 없는 줄에 그 안내가 붙는다.
 *
 * 모르는 모드 값은 남긴다. 이 표면이 이벤트의 기본 자리라, 판단이 서지 않는 줄을
 * 감추면 운영자가 등록한 팝업이 아무 화면에도 뜨지 않는 쪽으로 사라진다.
 */
export function selectOfflinePopupEvents(events: FandomEvent[]): FandomEvent[] {
  return events.filter((event) => event.mode !== ONLINE_MODE);
}

export function selectFandomEvents(events: FandomEvent[], filter: EventFilter): FandomEvent[] {
  return events
    .filter(
      (event) =>
        (filter.ipId === ALL_IPS || event.ip === filter.ipId) &&
        (filter.mode === ALL_MODES || event.mode === filter.mode) &&
        (filter.status === ALL_STATUSES || event.status === filter.status),
    )
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
}
