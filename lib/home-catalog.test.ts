import { describe, expect, it } from 'vitest';
import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { Card, FandomEvent, Good, Ip, Vertical } from './data';
import {
  buildHomeIpWorld,
  getHomeSelectableIps,
  MAX_HOME_PICKER_IPS,
  prioritizeHomePostPreviews,
} from './home-catalog';

const vertical: Vertical = { key: 'global', label: '글로벌 IP', color: '#2DE2FF' };

function ip(id: string, featured = false): Ip {
  return {
    id,
    title: `IP ${id}`,
    sub: '테스트',
    v: vertical,
    glyph: id.toUpperCase(),
    bg: `bg-${id}`,
    fans: 1000,
    goods: 1,
    cards: 1,
    featured,
    tagline: `${id} tagline`,
    synopsis: `${id} synopsis`,
  };
}

function good(id: string, ipId: string): Good {
  return {
    id,
    ip: ipId,
    name: `Good ${id}`,
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 10,
    img: `good-${id}`,
  };
}

function card(id: string, ipId: string): Card {
  return {
    id,
    ip: ipId,
    name: `Card ${id}`,
    no: '001/010',
    rarity: 'SR',
    owned: false,
    bg: `card-${id}`,
  };
}

function event(id: string, ipId: string | null): FandomEvent {
  return {
    id,
    ip: ipId,
    title: `Event ${id}`,
    mode: '오프라인',
    status: '예정',
    date: '6.30',
    loc: '서울',
    accent: '#2DE2FF',
    img: `event-${id}`,
  };
}

function post(id: string, ipName: string): CatalogPostPreview {
  return {
    id,
    user: `user-${id}`,
    ipName,
    avatar: '#2DE2FF',
    text: `${id} text`,
    likes: 10,
    comments: 2,
    time: '방금 전',
    tag: '후기',
  };
}

function catalog(overrides: Partial<CatalogSnapshot>): CatalogSnapshot {
  return {
    source: 'mock',
    verticals: [vertical],
    ips: [],
    goods: [],
    cards: [],
    events: [],
    ...overrides,
  };
}

describe('getHomeSelectableIps', () => {
  it('returns featured IPs first and caps the picker at five entries', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('featured-1', true),
        ip('featured-2', true),
        ip('featured-3', true),
        ip('featured-4', true),
        ip('featured-5', true),
        ip('featured-6', true),
        ip('regular-1'),
      ],
    }));

    expect(selectable).toHaveLength(MAX_HOME_PICKER_IPS);
    expect(selectable.map((item) => item.id)).toEqual([
      'featured-1',
      'featured-2',
      'featured-3',
      'featured-4',
      'featured-5',
    ]);
  });

  it('falls back to the first five IPs when no featured IP exists', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [ip('one'), ip('two'), ip('three'), ip('four'), ip('five'), ip('six')],
    }));

    expect(selectable.map((item) => item.id)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('uses curated IP order, removes duplicates and missing IDs, and only then caps at five', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('one', true),
        ip('two'),
        ip('three'),
        ip('four'),
        ip('five'),
        ip('six'),
      ],
    }), ['missing', 'six', 'six', 'five', 'four', 'three', 'two', 'one']);

    expect(selectable.map((item) => item.id)).toEqual(['six', 'five', 'four', 'three', 'two']);
  });

  it('falls back to the first five catalog IPs for an explicit empty Supabase curation', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('regular-first'),
        ip('legacy-featured', true),
        ip('three'),
        ip('four'),
        ip('five'),
        ip('six'),
      ],
    }), []);

    expect(selectable.map((item) => item.id)).toEqual([
      'regular-first',
      'legacy-featured',
      'three',
      'four',
      'five',
    ]);
  });

  it('falls back to the first five catalog IPs when no curated ID exists in the catalog', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [ip('regular-first'), ip('legacy-featured', true), ip('three')],
    }), ['missing', 'also-missing']);

    expect(selectable.map((item) => item.id)).toEqual(['regular-first', 'legacy-featured', 'three']);
  });

  it('keeps the legacy featured fallback only when curated IDs are undefined', () => {
    const snapshot = catalog({
      ips: [ip('regular-first'), ip('legacy-featured', true), ip('regular-last')],
    });

    expect(getHomeSelectableIps(snapshot, undefined).map((item) => item.id)).toEqual(['legacy-featured']);
    expect(getHomeSelectableIps(snapshot, []).map((item) => item.id)).toEqual([
      'regular-first',
      'legacy-featured',
      'regular-last',
    ]);
  });
});

describe('buildHomeIpWorld', () => {
  it('uses the first selectable IP as the default selection', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true), ip('regular-1')],
    }));

    expect(world.selectedIp?.id).toBe('featured-1');
    expect(world.selectableIps.map((item) => item.id)).toEqual(['featured-1', 'featured-2']);
  });

  it('derives representative goods, cards, and events from the selected IP only', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('hwasan', true), ip('lumen', true)],
      goods: [good('other-good', 'lumen'), good('selected-good', 'hwasan')],
      cards: [card('other-card', 'lumen'), card('selected-card', 'hwasan')],
      events: [event('global-event', null), event('other-event', 'lumen'), event('selected-event', 'hwasan')],
    }), 'hwasan', {
      hwasan: post('selected-post', 'IP hwasan'),
      lumen: post('other-post', 'IP lumen'),
    });

    expect(world.representativeGood?.id).toBe('selected-good');
    expect(world.representativeCard?.id).toBe('selected-card');
    expect(world.representativeEvent?.id).toBe('selected-event');
    expect(world.representativePost?.id).toBe('selected-post');
  });

  it('recovers to the default IP when the requested selection is not available', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true)],
      goods: [good('default-good', 'featured-1'), good('other-good', 'featured-2')],
      cards: [card('default-card', 'featured-1')],
      events: [event('default-event', 'featured-1')],
    }), 'missing');

    expect(world.selectedIp?.id).toBe('featured-1');
    expect(world.representativeGood?.id).toBe('default-good');
  });

  it('uses null representative post when the selected IP has no preview', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true)],
    }), 'featured-2', {
      'featured-1': post('default-post', 'IP featured-1'),
    });

    expect(world.selectedIp?.id).toBe('featured-2');
    expect(world.representativePost).toBeNull();
  });
});

describe('prioritizeHomePostPreviews', () => {
  it('moves followed-IP previews first while preserving both groups order', () => {
    const previews = {
      hwasan: post('hwasan', 'IP hwasan'),
      lumen: post('lumen', 'IP lumen'),
      maple: post('maple', 'IP maple'),
    };

    expect(prioritizeHomePostPreviews(previews, new Set(['lumen', 'maple'])).map(([ipId]) => ipId)).toEqual([
      'lumen',
      'maple',
      'hwasan',
    ]);
  });

  it('keeps the existing order and excludes empty previews when there are no follows', () => {
    const previews = {
      hwasan: post('hwasan', 'IP hwasan'),
      empty: null,
      lumen: post('lumen', 'IP lumen'),
    };

    expect(prioritizeHomePostPreviews(previews, new Set()).map(([ipId]) => ipId)).toEqual(['hwasan', 'lumen']);
  });
});
