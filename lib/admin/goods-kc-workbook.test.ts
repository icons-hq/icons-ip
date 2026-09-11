import { describe, expect, it } from 'vitest';
import { emptyGoodsKcModel, type AdminGoodsKc } from './goods-kc';
import { exportGoodsKcWorkbookRows, goodsKcWorkbookOrphanErrors, planGoodsKcWorkbookRows } from './goods-kc-workbook';
const one = '00000000-0000-4000-8000-000000000001';
const two = '00000000-0000-4000-8000-000000000002';
const review: AdminGoodsKc = {
  revision: 3, status: 'reviewed', contextFingerprint: 'a'.repeat(64), publishedAt: '2026-09-10T00:00:00Z', archivedAt: null,
  reviewedAt: '2026-09-10T00:00:00Z', reviewerName: '담당자', history: [],
  variants: [{ id: one, code: '0001', name: '기본', active: true }, { id: two, code: '0002', name: '파랑', active: true }],
  models: [
    { ...emptyGoodsKcModel(), family: 'children', scheme: 'safety_confirmation', productCategory: '합성 분류',
      modelName: '합성 모델 A', businessRole: 'importer', businessName: '합성 사업자', identifier: 'TEST-ONLY-001',
      variantIds: [one], basis: '내부판단 A', evidence: { applicability: 'TEST:A', certificate: 'TEST:certA', testReport: '', declaration: '' } },
    { ...emptyGoodsKcModel(), family: 'living', scheme: 'supplier_conformity', productCategory: '합성 분류',
      modelName: '합성 모델 B', businessRole: 'manufacturer', businessName: '합성 사업자', variantIds: [two], basis: '내부판단 B',
      evidence: { applicability: 'TEST:B', certificate: '', testReport: 'TEST:reportB', declaration: 'TEST:declarationB' } },
  ],
};
const exported = () => exportGoodsKcWorkbookRows([{ goodCode: 'GOOD-001', review }]).map((values, index) => ({ row: index + 5, values }));
const context = { goodCode: 'GOOD-001', existing: review, variantCodes: ['0001', '0002'], willBeDraft: false };
describe('KC 검토 시트 왕복과 원자 저장 계획', () => {
  it('복수 모델·유형·번호·근거를 사람이 읽는 열로 내보내고 무변경 재업로드는 완료를 보존한다', () => {
    const rows = exported();
    expect(rows[0].values).toMatchObject({ modelIndex: '1', family: '어린이제품', scheme: '안전확인', variantCodes: '0001',
      identifier: 'TEST-ONLY-001', certificateReference: 'TEST:certA', reviewStatus: '검토 완료', reviewRevision: '3' });
    expect(rows[1].values.variantCodes).toBe('0002');
    expect(planGoodsKcWorkbookRows(rows, context)).toEqual({ kind: 'keep', warnings: [] });
    expect(planGoodsKcWorkbookRows([...rows].reverse(), context)).toEqual({ kind: 'keep', warnings: [] });
  });
  it('시트나 대상 행이 없으면 기존 정보를 지우지 않고 명시 초기화만 미검토로 저장한다', () => {
    expect(planGoodsKcWorkbookRows(null, context).kind).toBe('keep');
    expect(planGoodsKcWorkbookRows([], context).kind).toBe('keep');
    const reset = planGoodsKcWorkbookRows(exported(), { ...context, willBeDraft: true, reset: true });
    expect(reset).toMatchObject({ kind: 'save', update: { models: [], expectedRevision: 3, expectedContextFingerprint: 'a'.repeat(64) } });
  });
  it('공개 중 편집은 초안 전환을 요구하고 편집된 내용은 완료 상태를 승계하지 않는다', () => {
    const rows = exported(); rows[0].values.certificateReference = 'TEST:new-document';
    expect(planGoodsKcWorkbookRows(rows, context).kind).toBe('error');
    const plan = planGoodsKcWorkbookRows(rows, { ...context, willBeDraft: true });
    expect(plan).toMatchObject({ kind: 'save', update: { expectedRevision: 3,
      models: [{ variantCodes: ['0001'], evidence: { certificate: 'TEST:new-document' } }, { variantCodes: ['0002'] }] } });
    if (plan.kind === 'save') {
      expect(JSON.stringify(plan.update)).not.toContain('reviewed');
      expect(JSON.stringify(plan.update)).not.toContain('reviewerName');
      expect(JSON.stringify(plan.update)).not.toContain('variantIds');
    }
  });
  it('읽기 전용 검토값 변조·오래된 버전·다른 상품 옵션코드는 거절한다', () => {
    const rows = exported(); rows[0].values.reviewStatus = '미검토';
    expect(planGoodsKcWorkbookRows(rows, { ...context, willBeDraft: true }).kind).toBe('error');
    const stale = exported(); stale[0].values.reviewRevision = '2';
    expect(planGoodsKcWorkbookRows(stale, { ...context, willBeDraft: true }).kind).toBe('error');
    const foreign = exported(); foreign[0].values.variantCodes = '다른상품-옵션';
    expect(planGoodsKcWorkbookRows(foreign, { ...context, willBeDraft: true }).kind).toBe('error');
  });
  it('행번호와 옵션코드 중복을 거절하고 상품 시트 없는 KC 행을 버리지 않는다', () => {
    const rows = exported(); rows[1].values.modelIndex = '1';
    expect(planGoodsKcWorkbookRows(rows, context).kind).toBe('error');
    const duplicates = exported(); duplicates[0].values.variantCodes = '0001\n0001';
    expect(planGoodsKcWorkbookRows(duplicates, context).kind).toBe('error');
    expect(goodsKcWorkbookOrphanErrors(exported(), ['OTHER'])).toHaveLength(2);
  });
  it('새 상품은 실제 저장할 코드로만 연결하고 공란 검토 필드는 미검토 초안으로 계획한다', () => {
    const rows = exported(); rows.forEach((row) => { row.values.reviewStatus = ''; row.values.reviewRevision = ''; });
    const plan = planGoodsKcWorkbookRows(rows, { ...context, existing: null, willBeDraft: true });
    expect(plan).toMatchObject({ kind: 'save', update: { expectedRevision: null, expectedContextFingerprint: null } });
  });
});
