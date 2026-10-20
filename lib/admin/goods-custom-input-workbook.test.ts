import { describe, expect, it, vi } from 'vitest';
import type { GoodsCustomInputConfig } from '@/lib/goods-custom-inputs';
import {
  emptyGoodsCustomInputWorkbookRow, exportGoodsCustomInputWorkbookRows, goodsCustomInputWorkbookConfig,
  goodsCustomInputWorkbookOrphanErrors, planGoodsCustomInputWorkbookRows,
  type GoodsCustomInputWorkbookInputRow, type GoodsCustomInputWorkbookRow,
} from './goods-custom-input-workbook';

const id1 = '00000000-0000-4000-8000-000000010001';
const id2 = '00000000-0000-4000-8000-000000010002';
const id3 = '00000000-0000-4000-8000-000000010003';
const existing: GoodsCustomInputConfig = { enabled: true, revision: 7, fields: [
  { id: id1, name: 'TEST 문구', active: true }, { id: id2, name: 'TEST 위치', active: true },
] };
const exported = () => exportGoodsCustomInputWorkbookRows([{ goodCode: '0001', config: existing }]);
const input = (rows = exported()): GoodsCustomInputWorkbookInputRow[] => rows.map((values, index) => ({ row: index + 5, values }));
const plan = (rows: GoodsCustomInputWorkbookInputRow[] | null | undefined, config = existing) =>
  planGoodsCustomInputWorkbookRows(rows, { goodCode: '0001', existing: config });
const blank = (values: Partial<GoodsCustomInputWorkbookRow> = {}): GoodsCustomInputWorkbookRow => ({
  ...emptyGoodsCustomInputWorkbookRow(), goodCode: '0001', mode: '편집', enabled: '예', revision: '7', ...values,
});

describe('직접입력형 옵션 workbook contract', () => {
  it('현재 조회 payload에서 정의를 읽고 중지된 항목도 ID·순서·버전과 함께 내보낸다', () => {
    const config = goodsCustomInputWorkbookConfig({ custom_inputs_enabled: false, custom_inputs_revision: 8,
      custom_input_fields: [{ ...existing.fields[1], active: false }, existing.fields[0]] });
    expect(exportGoodsCustomInputWorkbookRows([{ goodCode: '0001', config }])).toEqual([
      { ...blank(), fieldId: id2, name: 'TEST 위치', action: '중지', enabled: '아니오', revision: '8' },
      { ...blank(), fieldId: id1, name: 'TEST 문구', action: '사용', enabled: '아니오', revision: '8' },
    ]);
    expect(() => goodsCustomInputWorkbookConfig({ custom_inputs_enabled: true, custom_input_fields: [] })).toThrow('읽지 못했습니다');
  });
  it.each([null, undefined, []])('미포함 시트·행 %s는 정의를 보존한다', rows => {
    expect(plan(rows)).toEqual({ kind: 'keep', warnings: [] });
  });
  it('다른 상품 행을 현재 상품에 적용하지 않고 고아 코드·빈 코드는 거절한다', () => {
    const other = input(exported().map(row => ({ ...row, goodCode: 'OTHER' })));
    expect(plan(other).kind).toBe('keep');
    expect(goodsCustomInputWorkbookOrphanErrors(other, ['0001'])).toHaveLength(2);
    expect(goodsCustomInputWorkbookOrphanErrors(input([blank({ goodCode: '' })]), [''])).toHaveLength(1);
    expect(goodsCustomInputWorkbookOrphanErrors(input([blank({ goodCode: ' abc ' })]), ['ABC'])).toEqual([]);
  });
  it('내보낸 정의가 같으면 새 ID 생성 없이 keep이며 오래된 버전은 거절한다', () => {
    const newFieldId = vi.fn(() => id3);
    expect(planGoodsCustomInputWorkbookRows(input(), { goodCode: '0001', existing, newFieldId }).kind).toBe('keep');
    expect(newFieldId).not.toHaveBeenCalled();
    expect(plan(input(exported().map(row => ({ ...row, revision: '6' }))))).toMatchObject({ kind: 'error', errors: [expect.stringContaining('최신 파일')] });
  });
  it('이름과 표시 순서를 바꿔도 기존 ID·기대 버전을 유지한다', () => {
    const rows = exported().reverse(); rows[1].name = 'TEST 새 문구';
    expect(plan(input(rows))).toMatchObject({ kind: 'save', expectedRevision: 7,
      config: { enabled: true, fields: [existing.fields[1], { ...existing.fields[0], name: 'TEST 새 문구' }] },
      warnings: expect.arrayContaining([expect.stringContaining('이름을 변경')]) });
  });
  it('전체 사용 중지는 항목의 ID·이름·개별 활성 상태를 보존한다', () => {
    expect(plan(input(exported().map(row => ({ ...row, enabled: '아니오' }))))).toMatchObject({
      kind: 'save', config: { enabled: false, fields: existing.fields }, expectedRevision: 7,
    });
  });
  it('개별 중지와 재개는 같은 ID를 유지하고 활성 항목이 없으면 전체 사용을 요구하지 않는다', () => {
    const rows = exported(); rows[1].action = '중지';
    expect(plan(input(rows))).toMatchObject({ kind: 'save', config: { enabled: true, fields: [existing.fields[0], { ...existing.fields[1], active: false }] } });
    expect(plan(input(exported().map(row => ({ ...row, action: '중지' }))))).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('하나 이상')]) });
    const stopped = { ...existing, fields: [existing.fields[0], { ...existing.fields[1], active: false }] };
    expect(plan(input(), stopped)).toMatchObject({ kind: 'save', config: { fields: existing.fields } });
  });
  it('행 누락은 삭제하지 않고 오류로 처리하며 명시적 삭제만 적용한다', () => {
    expect(plan(input(exported().slice(0, 1)))).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('모두 포함')]) });
    const rows = exported(); rows[1].action = '삭제';
    expect(plan(input(rows))).toMatchObject({ kind: 'save', config: { enabled: true, fields: [existing.fields[0]] },
      warnings: expect.arrayContaining([expect.stringContaining('1개를 삭제')]) });
    expect(plan(input(exported().map(row => ({ ...row, enabled: '아니오', action: '삭제' }))))).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('전체 해제')]) });
  });
  it('전체 해제는 한 제어 행으로 명시하며 항목 행과 혼합하거나 일부 값을 남기지 못한다', () => {
    const clear = blank({ mode: '전체 해제', enabled: '아니오' });
    expect(plan(input([clear]))).toMatchObject({ kind: 'save', config: { enabled: false, fields: [] }, expectedRevision: 7 });
    for (const rows of [[{ ...clear, name: '남은 이름' }], [clear, ...exported()], [{ ...clear, enabled: '예' }]]) {
      expect(plan(input(rows)).kind).toBe('error');
    }
    expect(planGoodsCustomInputWorkbookRows(input([{ ...clear, revision: '0' }]), { goodCode: '0001', existing: null }).kind).toBe('keep');
  });
  it('새 ID는 검증을 통과한 후 서버 factory에서 한 번 생성한다', () => {
    const rows = input([...exported(), blank({ name: 'TEST 추가 문구', action: '사용' })]);
    const newFieldId = vi.fn(() => id3);
    const result = planGoodsCustomInputWorkbookRows(rows, { goodCode: '0001', existing, newFieldId });
    expect(result).toMatchObject({ kind: 'save', config: { fields: [...existing.fields, { id: id3, name: 'TEST 추가 문구', active: true }] } });
    expect(newFieldId).toHaveBeenCalledTimes(1);
    expect(rows[2].values.fieldId).toBe('');
    expect(plan(rows)).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('다시 검증')]) });
  });
  it('명시한 신규 상품코드는 버전 0·빈 ID를 요구한다', () => {
    const rows = input([blank({ revision: '0', name: 'TEST 새 상품 문구', action: '사용' })]);
    expect(planGoodsCustomInputWorkbookRows(rows, { goodCode: '0001', existing: null, newFieldId: () => id3 })).toMatchObject({
      kind: 'save', expectedRevision: 0, config: { enabled: true, fields: [{ id: id3, name: 'TEST 새 상품 문구', active: true }] },
    });
  });
  it('다른 상품 ID·중복 ID·중복 이름·셀 오류는 새 ID를 발급하기 전에 거절한다', () => {
    const newFieldId = vi.fn(() => id3);
    for (const rows of [
      input([...exported(), blank({ fieldId: id3, name: 'TEST 외부 ID', action: '사용' })]),
      input([...exported(), { ...exported()[0] }]),
      input([...exported(), blank({ name: existing.fields[0].name, action: '사용' })]),
      input([...exported(), blank({ name: 'TEST 오류 항목', action: '사용' })]).map(row => ({ ...row, errors: ['수식은 사용할 수 없습니다.'] })),
    ]) expect(planGoodsCustomInputWorkbookRows(rows, { goodCode: '0001', existing, newFieldId }).kind).toBe('error');
    expect(newFieldId).not.toHaveBeenCalled();
  });
  it('Unicode 이름 상한·제어문자·그룹 설정·버전 형식·파일 내 편집 수를 검사한다', () => {
    const valid = exported(); valid[0].name = '😀'.repeat(25);
    expect(plan(input(valid)).kind).toBe('save');
    for (const edit of [{ name: '😀'.repeat(26) }, { name: '첫줄\n둘째줄' }, { enabled: 'Y' }, { mode: '알수없음' }, { revision: '07' }, { revision: '2147483648' }]) {
      const rows = exported(); rows[0] = { ...rows[0], ...edit };
      expect(plan(input(rows)).kind).toBe('error');
    }
    expect(plan(input(Array.from({ length: 11 }, () => exported()[0]))).kind).toBe('error');
  });
  it('기존 5개를 명시 삭제하고 새 5개로 교체하는 10행을 지원한다', () => {
    const config = { ...existing, fields: Array.from({ length: 5 }, (_, index) => ({ id: `00000000-0000-4000-8000-00000001000${index}`, name: `TEST 기존 ${index}`, active: true })) };
    const rows = exportGoodsCustomInputWorkbookRows([{ goodCode: '0001', config }]).map(row => ({ ...row, action: '삭제' }));
    rows.push(...Array.from({ length: 5 }, (_, index) => blank({ name: `TEST 신규 ${index}`, action: '사용' })));
    let next = 0;
    const result = planGoodsCustomInputWorkbookRows(input(rows), { goodCode: '0001', existing: config, newFieldId: () => `00000000-0000-4000-8000-00000002000${next++}` });
    expect(result).toMatchObject({ kind: 'save', config: { fields: expect.any(Array) } });
    if (result.kind === 'save') expect(result.config.fields).toHaveLength(5);
    const tooMany = input([...exported(), ...Array.from({ length: 4 }, (_, index) => blank({ name: `TEST 추가 ${index}`, action: '사용' }))]);
    expect(planGoodsCustomInputWorkbookRows(tooMany, { goodCode: '0001', existing, newFieldId: () => id3 }).kind).toBe('error');
  });
});
