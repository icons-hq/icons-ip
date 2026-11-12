import { describe, expect, it } from 'vitest';
import {
  emptyGoodsOtherCertification, goodsOtherCertificationProblems, goodsOtherCertificationsSaveError, normalizeGoodsOtherCertifications,
  parseAdminGoodsOtherCertifications, parseGoodsOtherCertificationsSaveInput, publicGoodsOtherCertifications,
} from './goods-kc-other-certifications';
import { goodsOtherCertificationRow, parseGoodsOtherCertificationDisclosures } from '@/lib/goods-kc';

/* SHEET-014(ADR-0036): 기타 인증 — 종류·인증번호 필수, 인증기관 선택, 고객 노출을 고른 것만 공개. DB 규칙(normalize_goods_other_certifications)과 같다. */
const radio = { kind: '방송통신기자재 적합성평가', agency: '국립전파연구원', number: 'R-R-TEST-0001', visible: true };
const hidden = { kind: '내부 보관 인증', agency: '', number: 'INTERNAL-1', visible: false };

describe('기타 인증 입력 규칙', () => {
  it('새 항목은 고객 상세에 표시하는 빈 칸으로 시작하고 앞뒤 공백을 지운다', () => {
    expect(emptyGoodsOtherCertification()).toEqual({ kind: '', agency: '', number: '', visible: true });
    expect(normalizeGoodsOtherCertifications([{ kind: '  전파 ', agency: '\t기관 ', number: ' R-1﻿', visible: false }]))
      .toEqual([{ kind: '전파', agency: '기관', number: 'R-1', visible: false }]);
  });

  it('형식·길이·제어 문자·최대 건수를 어기면 받지 않는다', () => {
    expect(normalizeGoodsOtherCertifications('x')).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ ...radio, extra: 1 }])).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ kind: '전파', agency: '', number: 'R-1' }])).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ ...radio, visible: 'true' }])).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ ...radio, kind: '전파\n인증' }])).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ ...radio, number: `R-1${String.fromCharCode(0x85)}` }])).toBeNull();
    expect(normalizeGoodsOtherCertifications([{ ...radio, kind: '가'.repeat(101) }])).toBeNull();
    /* DB char_length처럼 코드 포인트로 센다 — 이모지 100자는 받는다. */
    expect(normalizeGoodsOtherCertifications([{ ...radio, kind: '😀'.repeat(100) }])).not.toBeNull();
    expect(normalizeGoodsOtherCertifications(Array.from({ length: 21 }, (_, index) => ({ ...radio, number: `R-${index}` })))).toBeNull();
  });

  it('종류·인증번호가 비거나 같은 인증(대소문자 무시)이 두 번이면 저장 전에 알린다', () => {
    expect(goodsOtherCertificationProblems([radio, hidden])).toEqual([]);
    expect(goodsOtherCertificationProblems([{ ...radio, number: ' ' }])).toEqual(['기타 인증 1: 인증 종류와 인증번호를 입력해주세요.']);
    expect(goodsOtherCertificationProblems([radio, { ...radio, kind: radio.kind.toUpperCase(), number: 'r-r-test-0001', visible: false }]))
      .toEqual(['기타 인증 2: 같은 인증 종류·인증번호가 이미 있습니다.']);
    expect(goodsOtherCertificationProblems([{ ...radio, kind: '가'.repeat(101) }])[0]).toContain('최대 20건');
  });

  it('고객에게는 노출을 고른 항목의 종류·인증기관·인증번호만 나간다', () => {
    expect(publicGoodsOtherCertifications([radio, hidden, { ...radio, kind: '', number: '' }])).toEqual([
      { kind: '방송통신기자재 적합성평가', agency: '국립전파연구원', number: 'R-R-TEST-0001' },
    ]);
    expect(goodsOtherCertificationRow({ kind: '전파', agency: '', number: 'R-1' })).toEqual(['전파', '인증번호 R-1']);
    expect(goodsOtherCertificationRow({ kind: '전파', agency: '기관', number: 'R-1' })).toEqual(['전파', '인증번호 R-1 · 인증기관 기관']);
  });

  it('고객 열 parser는 allowlist만 받고 어긋나면 실패한다', () => {
    const disclosures = [{ kind: '전파', agency: '', number: 'R-1' }];
    expect(parseGoodsOtherCertificationDisclosures(disclosures)).toEqual(disclosures);
    expect(parseGoodsOtherCertificationDisclosures([])).toEqual([]);
    expect(parseGoodsOtherCertificationDisclosures([{ ...disclosures[0], visible: true }])).toBeNull();
    expect(parseGoodsOtherCertificationDisclosures([{ kind: '전파', agency: '' }])).toBeNull();
    expect(parseGoodsOtherCertificationDisclosures([{ kind: ' ', agency: '', number: 'R-1' }])).toBeNull();
    expect(parseGoodsOtherCertificationDisclosures({})).toBeNull();
  });
});

describe('기타 인증 서버 응답·저장 요청', () => {
  const configuration = { revision: 2, entries: [radio, hidden], publishedAt: '2026-11-12T00:00:00Z', archivedAt: null,
    updatedAt: '2026-11-12T01:00:00Z', updatedByName: '합성 운영자' };
  it('응답을 엄격하게 읽고, 버전 없는 기록에 항목이 있으면 거절한다', () => {
    expect(parseAdminGoodsOtherCertifications(configuration)).toEqual(configuration);
    expect(parseAdminGoodsOtherCertifications({ ...configuration, revision: null, entries: [], updatedAt: null, updatedByName: null })?.revision).toBeNull();
    expect(parseAdminGoodsOtherCertifications({ ...configuration, revision: null })).toBeNull();
    expect(parseAdminGoodsOtherCertifications({ ...configuration, revision: 0 })).toBeNull();
    expect(parseAdminGoodsOtherCertifications({ ...configuration, entries: [{ ...radio, number: '' }] })).toBeNull();
    expect(parseAdminGoodsOtherCertifications({ ...configuration, updatedAt: 'x' })).toBeNull();
  });
  it('저장 요청은 항목 규칙을 통과하고 버전을 함께 보낼 때만 만든다', () => {
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [radio], expectedRevision: null })).toEqual({ entries: [radio], expectedRevision: null });
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [], expectedRevision: 3 })).toEqual({ entries: [], expectedRevision: 3 });
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [{ ...radio, number: '' }], expectedRevision: null })).toBeNull();
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [radio] })).toBeNull();
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [radio], expectedRevision: 1.5 })).toBeNull();
    expect(parseGoodsOtherCertificationsSaveInput({ entries: [radio], expectedRevision: null, actor: 'x' })).toBeNull();
  });
  it('저장 오류를 운영자 문장으로 바꾼다', () => {
    expect(goodsOtherCertificationsSaveError('goods_other_certifications_changed')).toContain('다른 작업에서 기타 인증이 바뀌었습니다');
    expect(goodsOtherCertificationsSaveError('goods_other_certification_incomplete')).toContain('인증 종류와 인증번호');
    expect(goodsOtherCertificationsSaveError('goods_other_certification_duplicate')).toContain('두 번');
    expect(goodsOtherCertificationsSaveError('catalog_item_archived')).toContain('복원');
    expect(goodsOtherCertificationsSaveError('unexpected')).toContain('저장하지 못했습니다');
  });
});
