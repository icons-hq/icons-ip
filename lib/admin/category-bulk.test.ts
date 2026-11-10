import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_BULK_LINE_LIMIT,
  categoryBulkReason,
  categoryBulkResultLabel,
  parseCategoryBulkResult,
  parseCategoryBulkText,
} from './category-bulk';

const erpCategories = readFileSync(new URL('./fixtures/erp-categories-2026-10-28.txt', import.meta.url), 'utf8');

describe('카테고리 일괄 등록 붙여넣기', () => {
  it('빈 줄을 건너뛰고 경로마다 원래 줄 번호를 기억한다', () => {
    expect(parseCategoryBulkText('\r\n문구>노트>스프링노트\r\n\n  \n 문구 > 메모/수첩 > 메모지 \n')).toEqual({
      paths: ['문구>노트>스프링노트', '문구 > 메모/수첩 > 메모지'],
      sourceLines: [2, 5],
    });
    expect(parseCategoryBulkText('   \n\n')).toEqual({ paths: [], sourceLines: [] });
  });

  /* H2 원천(ERP 제상품 분류 297줄, 2단 예외 1줄, 이름에 '/'가 든 117줄)을 그대로 붙여넣을 수 있어야 한다. */
  it('ERP 분류표 297줄을 한 번에 받는다', () => {
    const parsed = parseCategoryBulkText(erpCategories);
    expect(parsed.paths).toHaveLength(297);
    expect(parsed.paths.length).toBeLessThanOrEqual(CATEGORY_BULK_LINE_LIMIT);
    expect(parsed.paths.filter((path) => path.split('>').length === 2)).toEqual(['화장품/미용>뷰티소품2']);
    expect(parsed.paths.filter((path) => path.includes('/'))).toHaveLength(117);
  });
});

describe('일괄 등록 결과', () => {
  const result = {
    createdCategories: 3, createdLines: 1, skippedLines: 1, failedLines: 1,
    lines: [
      { line: 1, path: '문구>노트>스프링노트', status: 'created', created: 3, reason: null },
      { line: 2, path: '문구>노트>스프링노트', status: 'skipped', created: 0, reason: null },
      { line: 3, path: '가>나>다>라>마', status: 'failed', created: 0, reason: 'category_depth_exceeded' },
    ],
  };

  it('RPC 결과를 검증하고 형식이 다르면 성공으로 보지 않는다', () => {
    expect(parseCategoryBulkResult(result)).toEqual(result);
    expect(parseCategoryBulkResult({ ...result, lines: [{ ...result.lines[0], status: 'done' }] })).toBeNull();
    expect(parseCategoryBulkResult({ ...result, createdCategories: '3' })).toBeNull();
    expect(parseCategoryBulkResult({ ...result, lines: null })).toBeNull();
    expect(parseCategoryBulkResult(null)).toBeNull();
  });

  it('결과·사유를 운영 문장으로 바꾼다', () => {
    expect(result.lines.map((line) => categoryBulkResultLabel(line.status as 'created'))).toEqual(['처리됨', '건너뜀', '실패']);
    expect(categoryBulkReason(result.lines[0] as never)).toBe('새 카테고리 3개를 만들었습니다.');
    expect(categoryBulkReason(result.lines[1] as never)).toBe('이미 등록된 경로입니다.');
    expect(categoryBulkReason(result.lines[2] as never)).toBe('카테고리는 최대 4단계까지만 만들 수 있습니다.');
    expect(categoryBulkReason({ line: 4, path: 'x', status: 'failed', created: 0, reason: 'category_has_goods' })).toContain('상품이 연결된 카테고리');
    expect(categoryBulkReason({ line: 4, path: 'x', status: 'failed', created: 0, reason: 'category_path_ambiguous' })).toContain('같은 이름');
    expect(categoryBulkReason({ line: 4, path: 'x', status: 'failed', created: 0, reason: 'invalid_category_path' })).toContain('빈 단계');
    expect(categoryBulkReason({ line: 4, path: 'x', status: 'failed', created: 0, reason: 'something_new' })).toBe('등록하지 못했습니다. 경로를 확인하세요.');
  });
});
