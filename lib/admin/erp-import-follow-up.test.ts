import { describe, expect, it } from 'vitest';
import { erpImportFollowUp, unlinkedErpCategories, unlinkedPastedCategories } from './erp-import-follow-up';

describe('ERP 반입 뒤 할 일', () => {
  it('DB가 거부한 행을 빼고 ERP 코드·분류를 중복 없이 모은다(분류 열을 안 고른 행은 분류 없음)', () => {
    expect(erpImportFollowUp([
      { row: 2, code: 'A1', name: '키링', category: '문구 > 키링' },
      { row: 3, code: 'A2', name: '스티커', category: '문구  >  스티커 ' },
      { row: 4, code: 'A3', name: '노트', category: '문구 > 노트' },
      { row: 5, code: 'A4', name: '스티커2', category: '문구 > 스티커' },
      { row: 6, code: 'A5', name: '분류 없음' },
      { row: 7, code: 'A6', name: '빈 분류', category: null },
    ], [{ row: 4 }])).toEqual({ codes: ['A1', 'A2', 'A4', 'A5', 'A6'], categories: ['문구 > 키링', '문구 > 스티커'] });
  });

  it('연결 필요는 품목이 있고 직접 연결·자동 연결이 모두 없는 분류다(연결 표와 같은 판정)', () => {
    expect(unlinkedErpCategories([
      { erpCategory: '직접 연결', itemCount: 2, categoryId: 'c1', fallbackCategoryId: null },
      { erpCategory: '자동 연결', itemCount: 2, categoryId: null, fallbackCategoryId: 'c2' },
      { erpCategory: '연결 필요', itemCount: 1, categoryId: null, fallbackCategoryId: null },
      { erpCategory: '품목 없음', itemCount: 0, categoryId: null, fallbackCategoryId: null },
    ])).toEqual(['연결 필요']);
  });

  it('붙여넣은 분류 중 연결 필요만 남기고, 공백 차이는 같은 분류로 본다', () => {
    expect(unlinkedPastedCategories(['문구 > 키링', '문구 > 스티커', '문구 > 노트'], ['문구  > 스티커', '다른 분류', '문구 > 키링']))
      .toEqual(['문구 > 키링', '문구 > 스티커']);
    expect(unlinkedPastedCategories([], ['문구 > 키링'])).toEqual([]);
  });
});
