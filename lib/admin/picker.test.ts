import { describe, expect, it } from 'vitest';
import { adminPickerLocalLoader, adminPickerLocalPage, adminPickerMatches } from './picker';

const items = Array.from({ length: 45 }, (_, index) => ({ id: `c${index + 1}`, name: index % 2 ? `키링 ${index + 1}` : `엽서 ${index + 1}`, kind: index % 2 ? 'ring' : 'card' }));
const request = { query: '', field: '', filter: '', page: 1 };

describe('공용 선택창 조회', () => {
  it('검색어의 낱말이 모두 들어 있어야 맞는다(순서·대소문자·전각 무시)', () => {
    expect(adminPickerMatches('홍실 아크릴 키링 HSQ-001', '키링 hsq')).toBe(true);
    expect(adminPickerMatches('홍실 아크릴 키링', 'ＨＳＱ')).toBe(false);
    expect(adminPickerMatches('홍실 아크릴 키링', '   ')).toBe(true);
  });

  it('20개씩 자르고 전체 개수를 함께 돌려준다', () => {
    const page = adminPickerLocalPage(items, { ...request, page: 2 }, { textOf: (item) => item.name });
    expect(page.rows.map((item) => item.id)).toEqual(items.slice(20, 40).map((item) => item.id));
    expect(page).toMatchObject({ total: 45, page: 2, pageSize: 20 });
  });

  it('범위를 벗어난 페이지는 마지막 페이지로 보정한다', () => {
    expect(adminPickerLocalPage(items, { ...request, page: 9 }, { textOf: (item) => item.name })).toMatchObject({ page: 3, total: 45 });
    expect(adminPickerLocalPage([], request, { textOf: () => '' })).toMatchObject({ page: 1, total: 0, rows: [] });
  });

  it('검색과 추가 조건을 함께 건다', async () => {
    const load = adminPickerLocalLoader(items, { textOf: (item) => item.name, matchesFilter: (item, filter) => item.kind === filter });
    const result = await load({ ...request, query: '키링', filter: 'ring' });
    expect('error' in result ? null : result.total).toBe(22);
    const none = await load({ ...request, query: '키링', filter: 'card' });
    expect('error' in none ? null : none.total).toBe(0);
  });
});
