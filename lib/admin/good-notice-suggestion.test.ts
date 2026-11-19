import { describe, expect, it, vi } from 'vitest';
import { SUGGEST_LOOKUP_FAILED, suggestNoticePresetByNames } from './good-notice-suggestion';

describe('고시 템플릿 제안 — 대표 카테고리 이름 경로', () => {
  it('말단에서 위로 올라가며 템플릿이 나오는 첫 이름을 쓰고 그 뒤 이름은 부르지 않는다', async () => {
    const find = vi.fn(async (name: string) => (name === '문구' ? { id: 'p1' } : null));
    const found = await suggestNoticePresetByNames(['미니 노트', '노트', '문구', '생활'], find, new Map());
    expect(found).toEqual({ name: '문구', preset: { id: 'p1' } });
    expect(find.mock.calls.map(([name]) => name)).toEqual(['미니 노트', '노트', '문구']);
  });
  it('어느 이름에도 템플릿이 없으면 제안하지 않는다', async () => {
    const find = vi.fn(async () => null);
    expect(await suggestNoticePresetByNames(['피규어', '굿즈'], find, new Map())).toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
    expect(await suggestNoticePresetByNames([], find, new Map())).toBeNull();
  });
  it('조회 결과(없음 포함)를 캐시해 같은 이름을 다시 부르지 않는다', async () => {
    const cache = new Map<string, { id: string } | null>();
    const find = vi.fn(async (name: string) => (name === '문구' ? { id: 'p1' } : null));
    await suggestNoticePresetByNames(['노트', '문구'], find, cache);
    await suggestNoticePresetByNames(['노트', '문구'], find, cache);
    await suggestNoticePresetByNames(['다이어리', '노트', '문구'], find, cache);
    expect(find.mock.calls.map(([name]) => name)).toEqual(['노트', '문구', '다이어리']);
  });
  it('조회 오류는 캐시하지 않아 다음 호출에서 다시 조회한다', async () => {
    const cache = new Map<string, { id: string } | null>();
    let broken = true;
    const find = vi.fn(async () => (broken ? SUGGEST_LOOKUP_FAILED : { id: 'p1' }));
    expect(await suggestNoticePresetByNames(['문구'], find, cache)).toBeNull();
    expect(cache.has('문구')).toBe(false);
    broken = false;
    expect(await suggestNoticePresetByNames(['문구'], find, cache)).toEqual({ name: '문구', preset: { id: 'p1' } });
    expect(find).toHaveBeenCalledTimes(2);
  });
  it('취소되면 결과를 돌려주지 않는다', async () => {
    const find = vi.fn(async () => ({ id: 'p1' }));
    expect(await suggestNoticePresetByNames(['문구'], find, new Map(), () => true)).toBeNull();
  });
});
