import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), book: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/goods-relations-export.server', async original => ({ ...await original<object>(), loadGoodsRelationsExport: mocks.load, buildGoodsRelationsWorkbook: mocks.book }));
import { GoodsRelationsExportError } from '@/lib/admin/goods-relations-export.server';
import { GET } from './route';
const url = 'https://example.test/api/admin/goods-relations/export?q=test&kind=codi&state=scheduled&page=5';
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue({ rows: [{ id: 'one' }] }); mocks.book.mockResolvedValue(Buffer.from('xlsx')); });
describe('연관상품 파일 경계', () => {
  it('목록과 같은 권한을 먼저 요구하고 조회 조건을 전달한다', async () => {
    const response = await GET(new Request(url));
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('/admin/catalog/related-goods');
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ query: 'test', kind: 'codi', state: 'scheduled' }));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('icons-goods-relations.xlsx'); expect(response.headers.get('x-icons-export-rows')).toBe('1');
  });
  it('비인가 요청은 파일 조회/생성을 하지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(GET(new Request(url))).rejects.toThrow('forbidden'); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.book).not.toHaveBeenCalled();
  });
  it.each([['limit', 400], ['changed', 409]] as const)('%s 실패는 다운로드 없이 원인을 표시한다', async (code, status) => {
    mocks.load.mockRejectedValueOnce(new GoodsRelationsExportError(code));
    const result = await GET(new Request(url)); expect(result.status).toBe(status); expect(await result.json()).toHaveProperty('error'); expect(mocks.book).not.toHaveBeenCalled();
  });
  it('일반 오류에 내부 예외 원문을 노출하지 않는다', async () => {
    mocks.load.mockRejectedValueOnce(new Error('private database detail'));
    const result = await GET(new Request(url)); expect(result.status).toBe(500); expect(await result.text()).not.toContain('private database detail');
  });
});
