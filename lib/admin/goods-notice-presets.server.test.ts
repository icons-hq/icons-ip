import { beforeEach, describe, expect, it, vi } from 'vitest';

/* supabase 조회 체인(from → select → eq → is → maybeSingle)을 기록한다. */
const mocks = vi.hoisted(() => {
  const calls: [string, unknown[]][] = [];
  const result = { current: { data: null as unknown, error: null as unknown } };
  const chain: Record<string, unknown> = {};
  for (const name of ['from', 'select', 'eq', 'is']) chain[name] = (...args: unknown[]) => { calls.push([name, args]); return chain; };
  chain.maybeSingle = async () => { calls.push(['maybeSingle', []]); return result.current; };
  return { calls, result, chain };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.chain }));

import { loadGoodNoticeOfGood } from './goods-notice-presets.server';

const row = {
  name: '아크릴 키링', notice_maker: '아이콘스', notice_origin: '대한민국', notice_material: '아크릴', notice_size: '50mm',
  notice_made_on: '2026-11', notice_as_manager: '고객센터', notice_as_contact: '02-000-0000',
};

beforeEach(() => { mocks.calls.length = 0; mocks.result.current = { data: null, error: null }; });

describe('다른 상품의 고시정보 읽기(loadGoodNoticeOfGood)', () => {
  it('고시를 저장하는 7칸과 상품명만 읽고 보관한 상품은 거른다', async () => {
    mocks.result.current = { data: row, error: null };
    await loadGoodNoticeOfGood('good-a');
    expect(mocks.calls.map(([name]) => name)).toEqual(['from', 'select', 'eq', 'is', 'maybeSingle']);
    expect(mocks.calls[0][1]).toEqual(['goods']);
    expect(mocks.calls[1][1]).toEqual(['name,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact']);
    expect(mocks.calls[2][1]).toEqual(['id', 'good-a']);
    expect(mocks.calls[3][1]).toEqual(['archived_at', null]);
  });

  it('고시 칸을 화면이 쓰는 이름(maker·origin·material·size·madeOn·asManager·asContact)으로 옮긴다', async () => {
    mocks.result.current = { data: row, error: null };
    await expect(loadGoodNoticeOfGood('good-a')).resolves.toEqual({
      name: '아크릴 키링',
      notice: { maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '50mm', madeOn: '2026-11', asManager: '고객센터', asContact: '02-000-0000' },
    });
  });

  it('비어 있는 칸은 비어 있는 채로 둔다(채워졌는지는 부르는 쪽이 판단한다)', async () => {
    mocks.result.current = { data: { ...row, notice_maker: null, notice_origin: '' }, error: null };
    const found = await loadGoodNoticeOfGood('good-a');
    expect(found?.notice.maker).toBeNull();
    expect(found?.notice.origin).toBe('');
  });

  it('상품이 없거나 보관됐으면 null이다', async () => {
    await expect(loadGoodNoticeOfGood('good-a')).resolves.toBeNull();
  });

  it('읽기 오류는 내부 사정 없는 문장의 예외로 올린다', async () => {
    mocks.result.current = { data: null, error: { message: 'permission denied for table goods' } };
    await expect(loadGoodNoticeOfGood('good-a')).rejects.toThrow('상품의 고시정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  });
});
