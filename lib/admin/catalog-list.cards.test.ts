import { describe, expect, it } from 'vitest';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import {
  adminCardListHref,
  buildAdminCardList,
  normalizeAdminCardListFilters,
} from './catalog-list';

/* 카드 목록의 참조 구현(규모 후속). RPC 와 규칙이 1:1 — 상태 판정·탭 건수·정렬. */

function card(overrides: Partial<AdminCardRecord> & Pick<AdminCardRecord, 'id'>): AdminCardRecord {
  return {
    archivedAt: null, ipId: 'ip-a', poolId: null, name: `카드 ${overrides.id}`, no: null,
    rarity: 'N', bg: null, imagePath: null, imageUrl: null, ...overrides,
  };
}
const POOL = '11111111-1111-4111-8111-111111111111';
const ips = [{ id: 'ip-a', title: '에이' }, { id: 'ip-b', title: '비' }];
const pools = [{ id: POOL, name: '봄 풀' }];

describe('normalizeAdminCardListFilters', () => {
  it('모르는 탭·정렬·깨진 풀 id 는 기본값으로 접는다', () => {
    const filters = normalizeAdminCardListFilters({ tab: 'nope', sort: 'price', pool: 'not-a-uuid', page: '0' });
    expect(filters).toMatchObject({ tab: 'all', sort: null, pool: '', page: 1 });
  });

  it('풀 id 는 소문자 uuid 로만 받는다', () => {
    expect(normalizeAdminCardListFilters({ pool: POOL.toUpperCase() }).pool).toBe(POOL);
  });
});

describe('buildAdminCardList', () => {
  const cards = [
    card({ id: 'c1', poolId: POOL, rarity: 'HOLO', no: '001' }),
    card({ id: 'c2', name: '홀로 둘', no: '002' }),
    card({ id: 'c3', ipId: 'ip-b', rarity: 'SSR', no: '003' }),
    card({ id: 'c4', ipId: 'ip-b', archivedAt: '2026-09-01T00:00:00Z', no: '004' }),
  ];
  const base = normalizeAdminCardListFilters({});

  it('탭 건수는 필터를 적용한 뒤, 탭을 나누기 전에 센다', () => {
    const list = buildAdminCardList(cards, ips, pools, { ...base, ip: 'ip-b' });
    expect(list.counts).toEqual({ all: 2, active: 1, archived: 1 });
    expect(list.rows.map((row) => row.card.id)).toEqual(['c3', 'c4']);
  });

  it('풀·등급·검색(이름·id·번호)으로 좁힌다 — 풀 이름과 IP 이름을 함께 싣는다', () => {
    expect(buildAdminCardList(cards, ips, pools, { ...base, pool: POOL }).rows[0]).toMatchObject({ poolName: '봄 풀', ipTitle: '에이' });
    expect(buildAdminCardList(cards, ips, pools, { ...base, rarity: 'SSR' }).rows.map((r) => r.card.id)).toEqual(['c3']);
    expect(buildAdminCardList(cards, ips, pools, { ...base, query: '003' }).rows.map((r) => r.card.id)).toEqual(['c3']);
    expect(buildAdminCardList(cards, ips, pools, { ...base, query: '홀로' }).rows.map((r) => r.card.id)).toEqual(['c2']);
  });

  it('정렬은 같은 키끼리 원래 순서를 지키고, 번호 정렬은 빈 번호를 앞에 둔다', () => {
    const list = buildAdminCardList(cards, ips, pools, { ...base, sort: 'no', dir: 'desc' });
    expect(list.rows.map((row) => row.card.id)).toEqual(['c4', 'c3', 'c2', 'c1']);
  });
});

describe('adminCardListHref', () => {
  it('기본값은 주소에서 빼고 조건은 남긴다', () => {
    const filters = normalizeAdminCardListFilters({ ip: 'ip-a', tab: 'archived', page: '2' });
    expect(adminCardListHref(filters, { selected: 'c1' })).toBe('/admin/catalog/cards?tab=archived&ip=ip-a&page=2&selected=c1');
    expect(adminCardListHref(normalizeAdminCardListFilters({}))).toBe('/admin/catalog/cards');
  });
});
