import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodOtherCompositions } from './good-other-compositions.server';

const mocks = vi.hoisted(() => ({ configured: true, rpc: vi.fn(), cards: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/catalog', () => ({ getCatalogGoodsByIds: mocks.cards }));
vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsAccess: async () => 'hidden' }));

const reference = () => ({ groups: [{ id: '99000000-0000-4000-8000-000000000301', title: '다른 구성도 살펴보세요', goods: [
  { goodId: 'good-1500', compositionLabel: '2개 세트' }, { goodId: 'good-b', compositionLabel: null },
] }], nextChangeAt: '2026-10-16T00:00:00+00:00' });
beforeEach(() => {
  vi.resetAllMocks(); mocks.configured = true;
  mocks.rpc.mockResolvedValue({ data: reference(), error: null });
  mocks.cards.mockImplementation(async (ids: string[]) => ids.map(id => ({ id })));
});

describe('다른 구성 공개 서버 loader', () => {
  it('공개 RPC 이후 현재 상품과 첫 목록 1000행 밖 후보도 ID로 직접 재조회한다', async () => {
    const data = await loadGoodOtherCompositions('good-current');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_good_other_compositions', { p_good_id: 'good-current' });
    expect(mocks.cards).toHaveBeenCalledExactlyOnceWith(['good-current', 'good-1500', 'good-b'], { adultGoods: 'hidden' });
    expect(data.groups[0].goods.map(({ good }) => good.id)).toEqual(['good-1500', 'good-b']);
    expect(data.unavailable).toBeUndefined();
  });

  it('정상 0후보는 후속 카탈로그 조회 없이 예약 경계를 보존한다', async () => {
    const data = { groups: [], nextChangeAt: '2026-10-16T00:00:00+00:00' };
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await loadGoodOtherCompositions('good-current')).toEqual(data);
    expect(mocks.cards).not.toHaveBeenCalled();
  });

  it('재조회에서 비공개가 된 후보나 현재 상품 때문에 비는 그룹은 정상 숨김이다', async () => {
    for (const cards of [[{ id: 'good-current' }], [{ id: 'good-b' }]]) {
      mocks.cards.mockResolvedValue(cards);
      expect(await loadGoodOtherCompositions('good-current')).toEqual({ groups: [], nextChangeAt: reference().nextChangeAt });
    }
  });

  it('RPC 전송·파싱 실패를 정상 0후보와 구별한다', async () => {
    for (const result of [{ data: null, error: { message: 'offline' } }, { data: null, error: null }, { data: {}, error: null }, { data: { ...reference(), hidden: 'secret' }, error: null }]) {
      mocks.rpc.mockResolvedValue(result);
      expect(await loadGoodOtherCompositions('good-current')).toEqual({ groups: [], nextChangeAt: null, unavailable: true });
    }
    mocks.rpc.mockRejectedValue(new Error('network'));
    expect(await loadGoodOtherCompositions('good-current')).toMatchObject({ unavailable: true });
    expect(mocks.cards).not.toHaveBeenCalled();
  });

  it('카탈로그 실패도 unavailable로 처리하고 현재 상품 혼입 응답은 재조회 전에 거절한다', async () => {
    mocks.cards.mockRejectedValue(new Error('catalog unavailable'));
    expect(await loadGoodOtherCompositions('good-current')).toMatchObject({ unavailable: true });
    mocks.cards.mockClear();
    expect(await loadGoodOtherCompositions('good-b')).toMatchObject({ unavailable: true });
    expect(mocks.cards).not.toHaveBeenCalled();
  });

  it('그룹 간 후보는 한 번만 재조회하고 1000 ID 제한에 맞춰 직접 조회를 나눈다', async () => {
    const groups = Array.from({ length: 112 }, (_, index) => ({ id: `99000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: '다른 구성',
      goods: Array.from({ length: 9 }, (_, member) => ({ goodId: `good-${index * 9 + member}`, compositionLabel: null })) }));
    groups.push({ ...groups[0], id: '99000000-0000-4000-8000-999999999999' });
    mocks.rpc.mockResolvedValue({ data: { groups, nextChangeAt: null }, error: null });
    const result = await loadGoodOtherCompositions('good-current');
    expect(mocks.cards.mock.calls.map(([ids]) => ids.length)).toEqual([1000, 9]);
    expect(new Set(mocks.cards.mock.calls.flatMap(([ids]) => ids)).size).toBe(1009);
    expect(result.groups).toHaveLength(113);
  });

  it('미설정 mock 환경에서는 외부 호출 없이 기본 숨김을 유지한다', async () => {
    mocks.configured = false;
    expect(await loadGoodOtherCompositions('good-current')).toEqual({ groups: [], nextChangeAt: null });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
