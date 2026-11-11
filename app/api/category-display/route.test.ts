import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { CategoryDisplayStaleError } from '@/lib/category-display.server';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/category-display.server', () => ({ loadCategoryDisplayPage: mocks.load, CategoryDisplayStaleError: class extends Error {} }));
const id = '93930000-0000-4000-8000-000000000011', token = 'a'.repeat(32);
const path = `https://example.test/api/category-display?displayCategory=${id}&offset=20&token=${token}`;
beforeEach(() => { vi.clearAllMocks(); });
describe('전시 다음 페이지 API', () => {
  it('스코프·중복·페이지 경계가 틀리면 DB를 호출하지 않는다', async () => {
    for (const url of [path.replace('offset=20', 'offset=21'), `${path}&offset=40`, `${path}&category=${id}`, path.replace(id, 'missing'), path.replace(token, 'invalid')]) {
      expect((await GET(new Request(url))).status).toBe(400);
    }
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('공개 데이터만 최소 응답하고 저장 캐시를 금지한다', async () => {
    mocks.load.mockResolvedValue({ result: { goods: [{ id: 'g1' }] }, token, nextOffset: 40, checkedAt: 'now', banner: { title: '배너' } });
    const result = await GET(new Request(path));
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual({ goods: [{ id: 'g1' }], reviewSummaries: {}, token, nextOffset: 40, checkedAt: 'now' });
    expect(mocks.load).toHaveBeenCalledWith(id, expect.objectContaining({ displayCategory: id }), 20, token);
  });
  it('다음 묶음의 카드 별점을 그 묶음 몫만 함께 돌려준다(CL-02)', async () => {
    mocks.load.mockResolvedValue({ result: { goods: [{ id: 'g1' }], reviewSummaries: { g1: { count: 2, average: 4 } } }, token, nextOffset: null, checkedAt: 'now' });
    expect(await (await GET(new Request(path))).json()).toEqual({ goods: [{ id: 'g1' }], reviewSummaries: { g1: { count: 2, average: 4 } }, token, nextOffset: null, checkedAt: 'now' });
  });
  it("정렬 7종과 타입 '예약판매' 조건을 그대로 DB 로 넘긴다", async () => {
    mocks.load.mockResolvedValue({ result: { goods: [] }, token, nextOffset: null, checkedAt: 'now' });
    expect((await GET(new Request(`${path}&sort=name_desc&type=${encodeURIComponent('예약판매')}`))).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(id, expect.objectContaining({ sort: 'name_desc', types: ['예약판매'] }), 20, token);
  });
  it('전시 해제·목록 변경·조회 오류를 빈 성공 목록으로 숨기지 않는다', async () => {
    mocks.load.mockResolvedValueOnce(null); expect((await GET(new Request(path))).status).toBe(404);
    mocks.load.mockRejectedValueOnce(new CategoryDisplayStaleError()); expect((await GET(new Request(path))).status).toBe(409);
    mocks.load.mockRejectedValueOnce(new Error('offline')); expect((await GET(new Request(path))).status).toBe(503);
  });
});
