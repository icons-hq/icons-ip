/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and drives one hook root per render. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 훅을 렌더러 없이 돌린다 — state·ref·effect 를 인덱스 대역으로 바꿔 effect 를 직접 실행한다(ProductInterestShelf 시험과 같은 방식). */
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { effect: () => void | (() => void); deps: unknown[] | undefined }[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
}));
const mocks = vi.hoisted(() => ({ configured: true, rpc: vi.fn(), createClient: vi.fn() }));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => {
      hooks.state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.state[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    hooks.effects[hooks.effectIndex++] = { effect, deps };
  },
}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));

import { useListingReviewSummaries } from './useListingReviewSummaries';

/* 한 번의 렌더 — 직전 렌더와 의존성이 같으면 React 처럼 effect 를 건너뛴다. */
let previousDeps: unknown[] | undefined;
function render(ids: readonly string[]) {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  const value = useListingReviewSummaries(ids);
  const { effect, deps } = hooks.effects[0];
  const changed = !previousDeps || !deps || deps.some((dep, index) => !Object.is(dep, previousDeps![index]));
  previousDeps = deps;
  if (changed) effect();
  return value;
}
async function flush() { for (let index = 0; index < 4; index += 1) await Promise.resolve(); }
const row = (goodId: string, reviewCount: number, ratingAverage: number) => ({ goodId, reviewCount, ratingAverage });

beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.effects = [];
  previousDeps = undefined;
  mocks.configured = true;
  mocks.rpc.mockReset();
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
});

describe('useListingReviewSummaries', () => {
  it('보이는 굿즈를 한 번의 공개 RPC 로 묻고 리뷰가 있는 굿즈만 별점을 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row('g1', 3, 4.33)], error: null });

    expect(render(['g2', 'g1', 'g1', 'bad id'])).toEqual({});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_goods_review_summaries', { p_good_ids: ['g1', 'g2'] });

    await flush();
    expect(render(['g2', 'g1'])).toEqual({ g1: { count: 3, average: 4.33 } });
    /* 같은 굿즈 목록이면 다시 묻지 않는다. */
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  /* 탭 전환·수량 변경으로 목록이 바뀌어도 이미 받은 별점은 꺼지지 않고 새로 보인 굿즈만 묻는다. */
  it('목록이 바뀌면 새 굿즈만 묻고 이미 받은 별점을 유지한다', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row('g1', 2, 4.5)], error: null })
      .mockResolvedValueOnce({ data: [row('g3', 1, 3)], error: null });

    render(['g1', 'g2']);
    await flush();
    expect(render(['g2', 'g3'])).toEqual({ g1: { count: 2, average: 4.5 } });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_goods_review_summaries', { p_good_ids: ['g3'] });

    await flush();
    expect(render(['g2', 'g3'])).toEqual({ g1: { count: 2, average: 4.5 }, g3: { count: 1, average: 3 } });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('실패한 묶음은 별점만 숨기고 그 굿즈가 다시 보이면 다시 묻는다', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: [row('g1', 5, 4.8)], error: null });

    render(['g1']);
    await flush();
    expect(render([])).toEqual({});
    render(['g1']);
    await flush();
    render([]);
    expect(render(['g1'])).toEqual({});
    await flush();
    expect(render(['g1'])).toEqual({ g1: { count: 5, average: 4.8 } });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it('요청하지 않은 굿즈·범위 밖 값은 버린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row('other', 3, 4), row('g1', 0, 4), row('g2', 2, 9)], error: null });

    render(['g1', 'g2']);
    await flush();
    expect(render(['g1', 'g2'])).toEqual({});
  });

  it('Supabase 미설정(mock) 실행과 빈 선반은 부르지 않는다', () => {
    expect(render([])).toEqual({});
    mocks.configured = false;
    expect(render(['g1'])).toEqual({});
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
