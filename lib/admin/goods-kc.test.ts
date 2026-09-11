import { describe, expect, it } from 'vitest';
import {
  emptyGoodsKcModel, goodsKcReviewProblems, normalizeGoodsKcModels,
  parseAdminGoodsKc, publicGoodsKcDisclosures, kcModelFromTemplate,
} from './goods-kc';
import { parseGoodsKcDisclosures } from '@/lib/goods-kc';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const variants = [
  { id: first, code: 'OPTION-01', name: '기본', active: true },
  { id: second, code: 'OPTION-02', name: '파랑', active: true },
];
function model() {
  return {
    ...emptyGoodsKcModel(), family: 'children' as const, scheme: 'safety_confirmation' as const,
    productCategory: '합성 시험용 분류', modelName: '합성 모델 A', businessRole: 'importer' as const,
    businessName: '합성 시험 수입자', identifier: 'TEST-ONLY-001', variantIds: [first],
    basis: '실제 제품을 판정하지 않는 자동 검증 자료',
    evidence: { applicability: 'TEST:classification', certificate: 'TEST:confirmation', testReport: '', declaration: '' },
  };
}

describe('모델별 KC 검토', () => {
  it('미검토 입력은 저장할 수 있지만 번호와 근거가 없으면 완료할 수 없다', () => {
    expect(normalizeGoodsKcModels([emptyGoodsKcModel()])).toEqual([emptyGoodsKcModel()]);
    const problems = goodsKcReviewProblems([emptyGoodsKcModel()], variants);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes('옵션'))).toBe(true);
    const incomplete = { ...model(), identifier: '', evidence: { ...model().evidence, certificate: '' } };
    expect(goodsKcReviewProblems([incomplete], variants.slice(0, 1)).join(' ')).toContain('번호');
    expect(goodsKcReviewProblems([incomplete], variants.slice(0, 1)).join(' ')).toContain('문서');
    expect(goodsKcReviewProblems([{ ...model(), basis: '\t\n\u00a0' }], variants.slice(0, 1)).join(' ')).toContain('판단 사유');
  });

  it('제품군과 제도를 검증하고 공급자적합성에 공통 인증번호를 요구하지 않는다', () => {
    expect(normalizeGoodsKcModels([{ ...model(), scheme: 'safety_standard_compliance' }])).toBeNull();
    const supplier = { ...model(), scheme: 'supplier_conformity' as const, identifier: '',
      evidence: { ...model().evidence, certificate: '', testReport: 'TEST:report', declaration: 'TEST:declaration' } };
    expect(goodsKcReviewProblems([supplier], variants.slice(0, 1))).toEqual([]);
    expect(goodsKcReviewProblems([{ ...supplier, identifier: '혼동할 인증번호' }], variants.slice(0, 1)).join(' ')).toContain('번호');
  });

  it('해당 없음은 모델·사업자·적용판단 근거와 고객 설명을 요구한다', () => {
    const none = { ...model(), family: 'other' as const, scheme: 'not_applicable' as const, identifier: '',
      publicNote: '합성 시험 자료이며 실제 판매 제품의 판정이 아님',
      evidence: { ...model().evidence, certificate: '' } };
    expect(goodsKcReviewProblems([none], variants.slice(0, 1))).toEqual([]);
    expect(goodsKcReviewProblems([{ ...none, publicNote: '' }], variants.slice(0, 1)).length).toBeGreaterThan(0);
    expect(goodsKcReviewProblems([{ ...none, evidence: { ...none.evidence, applicability: '' } }], variants.slice(0, 1)).length).toBeGreaterThan(0);
  });

  it('각 활성 옵션의 명시된 모델 연결을 요구하고 다른 옵션이나 중복 연결을 거절한다', () => {
    expect(goodsKcReviewProblems([model()], variants).join(' ')).toContain('파랑');
    expect(goodsKcReviewProblems([model(), { ...model(), modelName: '합성 모델 B', variantIds: [second] }], variants)).toEqual([]);
    expect(normalizeGoodsKcModels([{ ...model(), variantIds: [first, first] }])).toBeNull();
    expect(goodsKcReviewProblems([{ ...model(), variantIds: ['00000000-0000-4000-8000-000000000003'] }], variants).join(' ')).toContain('없는 옵션');
    expect(goodsKcReviewProblems([model()], [variants[0], { ...variants[1], active: false }])).toEqual([]);
  });

  it('공개 고시에 내부 참조·검토 사유·담당자를 전달하지 않는다', () => {
    const disclosures = publicGoodsKcDisclosures([model()], variants.slice(0, 1));
    expect(disclosures[0]).toMatchObject({ modelName: '합성 모델 A', identifier: 'TEST-ONLY-001', variants: [{ id: first, name: '기본' }] });
    const json = JSON.stringify(disclosures);
    expect(json).not.toContain('TEST:');
    expect(json).not.toContain('basis');
    expect(parseGoodsKcDisclosures(disclosures)).toEqual(disclosures);
    expect(parseGoodsKcDisclosures([{ ...disclosures[0], evidence: model().evidence }])).toBeNull();
  });

  it('유형 틀 적용은 모델·번호·증빙·옵션을 자동 복사하지 않는다', () => {
    expect(kcModelFromTemplate('living', 'supplier_conformity')).toEqual({
      ...emptyGoodsKcModel(), family: 'living', scheme: 'supplier_conformity',
    });
    expect(kcModelFromTemplate('children', 'safety_standard_compliance')).toBeNull();
  });

  it('기존 공개 미기록 상태를 완료로 만들지 않고 엄격하게 응답을 읽는다', () => {
    const raw = { revision: null, status: 'unreviewed', models: [], publishedAt: '2026-09-10T00:00:00Z',
      archivedAt: null, reviewedAt: null, reviewerName: null, contextFingerprint: 'a'.repeat(64), variants, history: [] };
    expect(parseAdminGoodsKc(raw)?.status).toBe('unreviewed');
    expect(parseAdminGoodsKc({ ...raw, status: 'reviewed' })).toBeNull();
    expect(parseAdminGoodsKc({ ...raw, contextFingerprint: '' })).toBeNull();
  });
});
