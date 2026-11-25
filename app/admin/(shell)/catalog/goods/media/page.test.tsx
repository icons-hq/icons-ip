import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 상품 동영상·숏클립 라우트: 상품 없이 열면 상품 고르기, 상품이 있으면 상품명과 상품 자동코드를 머리말에 싣는다. */
const mocks = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), maybeSingle: vi.fn(), reads: [] as string[][] }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_')) throw error; },
}));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.access }));
vi.mock('@/lib/admin/goods-media.server', () => ({ loadAdminGoodMedia: mocks.load }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => ({ select: (columns: string) => ({ eq: (column: string, value: string) => { mocks.reads.push([table, columns, column, value]); return { maybeSingle: mocks.maybeSingle }; } }) }) }),
}));
vi.mock('@/app/admin/goods-media-actions', () => ({ saveGoodMediaAction: vi.fn(), cancelGoodsMediaAction: vi.fn(), verifyGoodsMediaAction: vi.fn(), prepareGoodsMediaAction: vi.fn() }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));

import { GoodsMediaGoodChooser } from '@/components/admin/GoodsMediaGoodChooser';
import { GoodsMediaScreen } from '@/components/admin/screens/GoodsMediaScreen';
import Page from './page';

const snapshot = { goodId: 'good-internal-1', goodName: '미니 피규어팩', revision: 0, video: null, shortclip: null };
const open = (query: Record<string, string | string[] | undefined>) => Page({ searchParams: Promise.resolve(query) });

beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue({});
  mocks.load.mockReset().mockResolvedValue(snapshot);
  mocks.maybeSingle.mockReset().mockResolvedValue({ data: { code: ' G10 ' }, error: null });
  mocks.reads.length = 0;
});

describe('상품 동영상·숏클립 라우트', () => {
  it('상품 관리 권한으로 연다', async () => {
    await open({});
    expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods/media', { capability: 'catalog.manage' });
  });

  it('상품 없이 열면 읽기 없이 상품 고르기 화면을 보인다', async () => {
    const element = await open({});
    expect((element as { type: unknown }).type).toBe(GoodsMediaGoodChooser);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.reads).toEqual([]);
  });

  it('주소의 상품 번호 모양이 틀리면 읽지 않고 없는 화면으로 보낸다', async () => {
    await expect(open({ goodId: 'Bad Id' })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('없는 상품이면 없는 화면이다', async () => {
    mocks.load.mockResolvedValue(null);
    await expect(open({ goodId: 'good-internal-1' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('상품 자동코드를 따로 읽어 화면에 넘기고, 머리말은 상품명과 코드로 보인다(내부 번호는 글로 보이지 않는다)', async () => {
    const element = await open({ goodId: 'good-internal-1' });
    expect((element as { type: unknown }).type).toBe(GoodsMediaScreen);
    expect((element as { props: { goodCode: string | null } }).props.goodCode).toBe('G10');
    expect(mocks.reads).toEqual([['goods', 'code', 'id', 'good-internal-1']]);
    const visible = renderToStaticMarkup(element as never).replace(/<[^>]+>/g, ' ');
    expect(visible).toContain('미니 피규어팩 · G10');
    expect(visible).not.toContain('good-internal-1');
  });

  it('상품 자동코드를 읽지 못해도 화면은 상품명만으로 열린다', async () => {
    mocks.maybeSingle.mockRejectedValue(new Error('db down'));
    const element = await open({ goodId: 'good-internal-1' });
    expect((element as { props: { goodCode: string | null } }).props.goodCode).toBeNull();
    expect(renderToStaticMarkup(element as never).replace(/<[^>]+>/g, ' ')).toContain('미니 피규어팩');
  });
});
