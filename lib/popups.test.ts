import { describe, expect, it } from 'vitest';
import type { CampaignSummary } from './campaigns';
import type { FandomEvent } from './data';
import {
  POPUP_EMPTY_TEXT,
  POPUP_LIST_LIMIT,
  POPUP_UPCOMING_BADGE,
  mergePopupItems,
  offlinePopupDetailHref,
  popupDetailHref,
  popupItemsFromCampaigns,
  popupItemsFromEvents,
  popupMetaLine,
  popupsHref,
  type PopupEventTimes,
  type PopupItem,
} from './popups';

const NOW = Date.parse('2026-11-17T03:00:00.000Z');

function event(overrides: Partial<FandomEvent> & Pick<FandomEvent, 'id'>): FandomEvent {
  return {
    title: `${overrides.id} 팝업`,
    ip: null,
    mode: '오프라인',
    status: '진행중',
    date: '11.01 - 11.30',
    loc: '성수 ICONS 스튜디오',
    accent: '#8B5CFF',
    img: 'url("https://cdn.test/e.png") center / cover no-repeat',
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignSummary> & Pick<CampaignSummary, 'id'>): CampaignSummary {
  return {
    kind: 'event',
    title: `${overrides.id} 캠페인`,
    subtitle: null,
    cardImagePath: null,
    bannerImagePath: null,
    featuredOrder: null,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-11-30T00:00:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    presentation: { popupMode: 'offline', popupLocation: '서울 마포구', cardLinkPath: null },
    ...overrides,
  };
}

function times(entries: Record<string, PopupEventTimes>): Map<string, PopupEventTimes> {
  return new Map(Object.entries(entries));
}

describe('POP-UP 경로', () => {
  it('목록·캠페인 상세·오프라인 팝업 상세 주소를 만든다', () => {
    expect(popupsHref()).toBe('/popups');
    expect(popupDetailHref('little riize')).toBe('/popups/little%20riize');
    expect(offlinePopupDetailHref('e 1/x')).toBe('/offline-popups/e%201%2Fx');
  });
});

describe('popupMetaLine', () => {
  it('방식 · 장소 · 기간을 점으로 잇고 빈 조각은 건너뛴다', () => {
    expect(popupMetaLine({ modeLabel: '오프라인', location: '성수', period: '11.01 - 11.30' })).toBe('오프라인 · 성수 · 11.01 - 11.30');
    expect(popupMetaLine({ modeLabel: '온라인', location: null, period: '2026.11.1 – 11.30' })).toBe('온라인 · 2026.11.1 – 11.30');
    expect(popupMetaLine({ modeLabel: '온·오프라인', location: '  ', period: '' })).toBe('온·오프라인');
  });
});

describe('popupItemsFromEvents (오프라인 팝업)', () => {
  it('오프라인의 진행중·예매중·예정만 싣고 종료·온라인 모드는 뺀다', () => {
    const items = popupItemsFromEvents([
      event({ id: 'live' }),
      event({ id: 'booking', status: '예매중' }),
      event({ id: 'soon', status: '예정' }),
      event({ id: 'done', status: '종료' }),
      event({ id: 'online', mode: '온라인' }),
      event({ id: 'weird', status: '보류' }),
    ], new Map(), NOW);

    expect(items.map((item) => [item.id, item.phase])).toEqual([
      ['live', 'ongoing'],
      ['booking', 'ongoing'],
      ['soon', 'upcoming'],
    ]);
  });

  it('끝 시각이 이미 지난 팝업은 상태가 진행중이어도 뺀다', () => {
    const items = popupItemsFromEvents(
      [event({ id: 'past' }), event({ id: 'open-ended' }), event({ id: 'future' })],
      times({
        past: { startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' },
        'open-ended': { startsAt: '2026-10-01T00:00:00.000Z', endsAt: null },
        future: { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' },
      }),
      NOW,
    );

    expect(items.map((item) => item.id)).toEqual(['open-ended', 'future']);
  });

  it('상세는 /offline-popups 로, 메타 한 줄은 방식 · 장소 · 날짜 표기로 만든다', () => {
    const [item] = popupItemsFromEvents([event({ id: 'e1', loc: '', date: '7.01 - 7.21' })], new Map(), NOW);

    expect(item).toMatchObject({
      key: 'event:e1',
      source: 'event',
      href: '/offline-popups/e1',
      meta: '오프라인 · 7.01 - 7.21',
      imageBg: 'url("https://cdn.test/e.png") center / cover no-repeat',
    });
  });

  it('시각을 읽지 못하면 시작 시각 없이도 싣는다', () => {
    const [item] = popupItemsFromEvents([event({ id: 'e1' })], new Map(), NOW);

    expect(item?.startsAtMs).toBeNull();
  });
});

describe('popupItemsFromCampaigns (POP-UP 캠페인)', () => {
  it('노출 설정에 POP-UP 방식이 있는 게시 캠페인만, 종료는 뺀다', () => {
    const items = popupItemsFromCampaigns([
      campaign({ id: 'live' }),
      campaign({ id: 'soon', displayState: 'upcoming' }),
      campaign({ id: 'done', displayState: 'ended' }),
      campaign({ id: 'draft', status: 'draft' }),
      campaign({ id: 'event-only', presentation: null }),
      campaign({ id: 'shortcut-only', presentation: { popupMode: null, popupLocation: null, cardLinkPath: '/shop' } }),
    ]);

    expect(items.map((item) => [item.id, item.phase])).toEqual([
      ['live', 'ongoing'],
      ['soon', 'upcoming'],
    ]);
  });

  it('상세는 /popups/<id>, 바로가기가 있으면 그곳으로 가고, 메타에 방식·장소·기간을 싣는다', () => {
    const [plain, shortcut] = popupItemsFromCampaigns([
      campaign({ id: 'plain', presentation: { popupMode: 'hybrid', popupLocation: '서울 마포구', cardLinkPath: null } }),
      campaign({ id: 'shortcut', presentation: { popupMode: 'online', popupLocation: null, cardLinkPath: '/ip/hong-sil-quest' } }),
    ]);

    expect(plain).toMatchObject({ href: '/popups/plain', meta: '온·오프라인 · 서울 마포구 · 2026.11.1 – 11.30' });
    expect(shortcut).toMatchObject({ href: '/ip/hong-sil-quest', meta: '온라인 · 2026.11.1 – 11.30' });
  });

  it('이미지는 카드 → 배너 → 히어로 순으로 고르고 없으면 null 이다', () => {
    const [card, banner, hero, none] = popupItemsFromCampaigns([
      campaign({ id: 'card', cardImagePath: 'https://cdn.test/c.png', bannerImagePath: 'https://cdn.test/b.png' }),
      campaign({ id: 'banner', bannerImagePath: 'https://cdn.test/b.png' }),
      campaign({ id: 'hero', heroImagePath: 'https://cdn.test/h.png' }),
      campaign({ id: 'none' }),
    ]);

    expect(card?.imageBg).toContain('https://cdn.test/c.png');
    expect(banner?.imageBg).toContain('https://cdn.test/b.png');
    expect(hero?.imageBg).toContain('https://cdn.test/h.png');
    expect(none?.imageBg).toBeNull();
  });
});

function item(overrides: Partial<PopupItem> & Pick<PopupItem, 'key'>): PopupItem {
  return {
    source: 'event',
    id: overrides.key,
    title: overrides.key,
    href: `/x/${overrides.key}`,
    imageBg: null,
    phase: 'ongoing',
    startsAtMs: 0,
    meta: '',
    ...overrides,
  };
}

describe('mergePopupItems', () => {
  it('진행 중은 시작 최신순, 오픈 예정은 시작 이른순으로 진행 중 뒤에 둔다 — 두 원천을 섞어서', () => {
    const merged = mergePopupItems(
      [
        item({ key: 'event:old', startsAtMs: 100 }),
        item({ key: 'event:soon', phase: 'upcoming', startsAtMs: 500 }),
      ],
      [
        item({ key: 'campaign:new', source: 'campaign', startsAtMs: 300 }),
        item({ key: 'campaign:later', source: 'campaign', phase: 'upcoming', startsAtMs: 900 }),
      ],
    );

    expect(merged.map((entry) => entry.key)).toEqual(['campaign:new', 'event:old', 'event:soon', 'campaign:later']);
  });

  it('시작 시각을 모르는 항목은 각 그룹 맨 뒤에 두고 같은 값은 키 순서로 고정한다', () => {
    const merged = mergePopupItems([
      item({ key: 'b', startsAtMs: null }),
      item({ key: 'a', startsAtMs: null }),
      item({ key: 'c', startsAtMs: 10 }),
      item({ key: 'u2', phase: 'upcoming', startsAtMs: null }),
      item({ key: 'u1', phase: 'upcoming', startsAtMs: 20 }),
    ]);

    expect(merged.map((entry) => entry.key)).toEqual(['c', 'a', 'b', 'u1', 'u2']);
  });

  it(`최대 ${POPUP_LIST_LIMIT}개만 싣는다 — 진행 중이 먼저 남는다`, () => {
    const ongoing = Array.from({ length: 40 }, (_, index) => item({ key: `on-${index}`, startsAtMs: index }));
    const upcoming = Array.from({ length: 40 }, (_, index) => item({ key: `up-${index}`, phase: 'upcoming', startsAtMs: index }));

    const merged = mergePopupItems(upcoming, ongoing);

    expect(merged).toHaveLength(POPUP_LIST_LIMIT);
    expect(merged.filter((entry) => entry.phase === 'ongoing')).toHaveLength(40);
    expect(merged.filter((entry) => entry.phase === 'upcoming')).toHaveLength(POPUP_LIST_LIMIT - 40);
  });

  it('원천이 모두 비면 빈 목록이다', () => {
    expect(mergePopupItems([], [])).toEqual([]);
  });
});

describe('POP-UP 문구', () => {
  it('빈 상태와 오픈 예정 배지 문구를 고정한다', () => {
    expect(POPUP_EMPTY_TEXT).toEqual({
      title: '진행 중인 POP-UP이 없어요',
      description: '새 POP-UP이 열리면 이 자리에서 가장 먼저 알려 드릴게요.',
      action: '홈으로 가기',
    });
    expect(POPUP_UPCOMING_BADGE).toBe('오픈 예정');
  });
});
