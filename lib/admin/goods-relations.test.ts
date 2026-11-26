import { describe, expect, it } from 'vitest';
import {
  goodsRelationConflict, goodsRelationError, goodsRelationHref, normalizeGoodsRelationFilters, parseGoodsRelationInput, parseGoodsRelation, parseRelationGoods,
  relationCustomerView, relationDraftState, relationGoodStatus, relationGoodStatusText, relationLimitBlock, relationListView, relationLossText,
  relationPeriodReadback, relationReadback, relationShownGoods, type GoodsRelationGoodVisibility, type GoodsRelationKind, type GoodsRelationState,
} from './goods-relations';

const id = '74000000-0000-4000-8000-000000000001';
const values = { kind: 'together', title: ' 함께 구매 ', representativeGoodId: 'good-a', enabled: true, startsAt: '2026-10-13T09:00', endsAt: '2026-10-14T09:00', goodIds: ['good-a', 'good-b'] };
describe('연관상품 입력과 응답 경계', () => {
  it('순서와 대표를 보존하고 한국 시각을 절대 시각으로 바꾼다', () => {
    expect(parseGoodsRelationInput({ id, revision: 3, values })).toEqual({ ok: true, id, revision: 3, values: { ...values, title: '함께 구매', startsAt: '2026-10-13T00:00:00.000Z', endsAt: '2026-10-14T00:00:00.000Z' } });
    const filters = normalizeGoodsRelationFilters({ q: ' 100% 상품 ', kind: 'similar', page: '3', state: 'scheduled', pageSize: '50' });
    const url = new URL(goodsRelationHref(filters, 2), 'https://test.local');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '100% 상품', kind: 'similar', page: '2', state: 'scheduled', pageSize: '50' });
  });
  it('잘못된 구성·개수·대표·달력·역전 기간을 저장 전에 거른다', () => {
    for (const overrides of [{ goodIds: ['good-a'] }, { goodIds: ['good-a', 'good-a'] }, { representativeGoodId: 'good-c' },
      { goodIds: Array.from({ length: 7 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0' },
      { startsAt: '2026-02-30T09:00' }, { endsAt: values.startsAt }, { enabled: 'true' }, { title: 'a'.repeat(16) }]) {
      expect(parseGoodsRelationInput({ id, revision: 0, values: { ...values, ...overrides } }).ok).toBe(false);
    }
  });
  it('실패나 깨진 응답을 유효한 편성으로 취급하지 않는다', () => {
    const saved = { id, revision: 1, kind: 'together', title: '함께 구매', representativeGoodId: 'good-a', enabled: true, startsAt: null, endsAt: null,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', state: 'active', goods: ['good-a', 'good-b'].map(id => ({ id, name: id, code: id, imagePath: null, public: true, visibility: 'public' })) };
    expect(parseGoodsRelation(saved)).toEqual(saved);
    expect(parseGoodsRelation({ ...saved, goods: saved.goods.slice(0, 1) })).toBeNull();
    expect(parseGoodsRelation({ ...saved, goods: [null] })).toBeNull();
  });
  it('이미지형과 코디는 2~5개, 검증 이미지와 현재 구성의 태그만 저장한다', () => {
    const visual = { imagePath: 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp', alt: '공간', description: '설명', hotspots: [{ goodId: 'good-a', x: 5000, y: 5000 }] };
    expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, kind: 'codi', visual } }).ok).toBe(true);
    expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, visual } }).ok).toBe(true);
    for (const patch of [{ kind: 'similar', visual }, { kind: 'codi', visual: null }, { visual, goodIds: ['good-a', 'good-b', 'good-c', 'good-d', 'good-e', 'good-f'] }, { visual: { ...visual, hotspots: [{ goodId: 'good-c', x: 1, y: 1 }] } }]) expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, ...patch } }).ok).toBe(false);
  });
  it('다른 구성은 2~10개와 선택적인 구성 표시값만 저장한다', () => {
    const other = { ...values, kind: 'other_composition', visual: null, compositionLabels: [{ goodId: 'good-a', label: '  300mL  ' }, { goodId: 'good-b', label: '　' }] };
    expect(parseGoodsRelationInput({ id, revision: 0, values: other })).toMatchObject({ ok: true, values: { compositionLabels: [{ goodId: 'good-a', label: '300mL' }] } });
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, goodIds: Array.from({ length: 10 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0', compositionLabels: [] } }).ok).toBe(true);
    for (const patch of [
      { goodIds: Array.from({ length: 11 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0', compositionLabels: [] },
      { compositionLabels: [{ goodId: 'missing', label: '2개' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '2개' }, { goodId: 'good-a', label: '3개' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '가'.repeat(41) }] },
      { compositionLabels: [{ goodId: 'good-a', label: '구성\n값' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '2개', private: true }] },
      { kind: 'similar' },
    ]) expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, ...patch } }).ok).toBe(false);
    expect(normalizeGoodsRelationFilters({ kind: 'other_composition' }).kind).toBe('other_composition');
  });
  it('다른 구성의 관리자 응답은 대표 비공개와 null 표시값을 그대로 보존한다', () => {
    const saved = { id, revision: 1, kind: 'other_composition', title: '다른 구성', representativeGoodId: 'good-a', enabled: true, startsAt: null, endsAt: null,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', state: 'active', visual: null,
      goods: ['good-a', 'good-b', 'good-c'].map((id, i) => ({ id, name: id, code: id, imagePath: null, public: i > 0, visibility: i > 0 ? 'public' : 'draft', compositionLabel: i === 1 ? '2개 세트' : null })) };
    expect(parseGoodsRelation(saved)).toEqual(saved);
    expect(parseGoodsRelation({ ...saved, goods: saved.goods.map(good => ({ ...good, compositionLabel: undefined })) })).toBeNull();
    expect(parseGoodsRelation({ ...saved, kind: 'similar' })).toBeNull();
  });
  it('다른 구성 제목은 공개 parser와 같은 문자를 허용하고 기존 유형의 제목 계약을 유지한다', () => {
    const other = { ...values, kind: 'other_composition', visual: null, compositionLabels: [] };
    for (const title of ['줄\n바꿈', '탭\t문자', '제어\u0085문자']) {
      expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, title } }).ok).toBe(false);
    }
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, title: '\u00a0다른 구성\ufeff' } })).toMatchObject({ ok: true, values: { title: '다른 구성' } });
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...values, title: '기존\n제목' } }).ok).toBe(true);
  });
});

describe('연관상품의 공개 판정 되읽기(R1)', () => {
  const row = (visibility: unknown, isPublic: unknown) => [{ id: 'good-a', name: '상품', code: 'A-1', imagePath: null, public: isPublic, visibility }];
  it('visibility가 없거나 public과 어긋난 응답은 받지 않는다', () => {
    expect(parseRelationGoods(row('public', true))).not.toBeNull();
    expect(parseRelationGoods(row('restricted', true))).not.toBeNull();
    for (const visibility of ['draft', 'ip_draft', 'archived', 'ip_archived']) expect(parseRelationGoods(row(visibility, false))).not.toBeNull();
    for (const [visibility, isPublic] of [[undefined, true], ['hidden', false], ['restricted', false], ['draft', true], ['public', false]]) {
      expect(parseRelationGoods(row(visibility, isPublic))).toBeNull();
    }
  });
  it('판매 제한 상품은 공개로 보이고 누구에게 보이는지를 따로 적는다', () => {
    expect(relationGoodStatus({ visibility: 'public' })).toEqual({ status: 'published', label: '공개', note: null });
    expect(relationGoodStatus({ visibility: 'restricted' })).toEqual({ status: 'published', label: '공개', note: '성인 인증 고객에게만' });
    expect(relationGoodStatusText({ visibility: 'restricted' })).toBe('공개 · 성인 인증 고객에게만');
    expect(relationGoodStatusText({ visibility: 'restricted' }, true)).toBe('공개 · 성인 상품 · 모든 고객에게 숨김');
    expect((['draft', 'ip_draft', 'archived', 'ip_archived'] as const).map(visibility => relationGoodStatusText({ visibility }))).toEqual(['초안', 'IP 초안', '보관', 'IP 보관']);
    const goods = (['public', 'restricted', 'draft'] as const).map((visibility, index) => ({ id: `g${index}`, visibility }));
    expect(relationShownGoods(goods).map(good => good.id)).toEqual(['g0', 'g1']);
    expect(relationShownGoods(goods, true).map(good => good.id)).toEqual(['g0']);
  });
});

describe('연관상품이 고객에게 보이는지 되읽기(R8·R11)', () => {
  const goods = (...list: GoodsRelationGoodVisibility[]) => list.map((visibility, index) => ({ id: `g${index}`, visibility }));
  const view = (list: GoodsRelationGoodVisibility[], options: { kind?: GoodsRelationKind; visual?: boolean; state?: GoodsRelationState; adultGoodsHidden?: boolean } = {}) =>
    relationCustomerView({ kind: options.kind ?? 'similar', visual: options.visual ?? false, state: options.state ?? 'active', representativeGoodId: 'g0', goods: goods(...list), adultGoodsHidden: options.adultGoodsHidden });
  const saved = (kind: GoodsRelationKind = 'similar') => ({ kind, unsaved: false });
  const unsaved = (kind: GoodsRelationKind = 'similar') => ({ kind, unsaved: true });

  it('새 연관상품의 기본값 전시중지와 기간 종료는 저장해도 보이지 않는다고 알린다', () => {
    expect(relationReadback(view(['public', 'public'], { state: 'stopped' }), unsaved())).toBe('전시중지라 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['public', 'public'], { state: 'stopped' }), saved())).toBe('전시중지라 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['public', 'public'], { state: 'ended' }), unsaved())).toBe('전시 기간이 끝나 저장해도 고객에게 보이지 않습니다.');
    expect(relationListView(view(['public', 'public'], { state: 'stopped' }))).toEqual({ shown: false, detail: '전시중지' });
    expect(relationListView(view(['public', 'public'], { state: 'ended' }))).toEqual({ shown: false, detail: '전시 기간 끝남' });
  });
  it('공개 상품이 2개 미만이거나 대표 상품이 안 보이면 까닭을 적는다', () => {
    expect(relationReadback(view(['public', 'draft']), unsaved())).toBe('공개 상품이 1개뿐이라 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['draft', 'archived']), unsaved())).toBe('공개 상품이 없어 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['draft', 'public', 'public']), unsaved())).toBe('대표 상품이 초안이라 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['ip_draft', 'public', 'public']), saved())).toBe('대표 상품이 IP 초안이라 고객에게 보이지 않습니다.');
    expect(relationListView(view(['archived', 'public', 'public']))).toEqual({ shown: false, detail: '대표 상품이 보관' });
    expect(relationListView(view(['public', 'draft']))).toEqual({ shown: false, detail: '공개 상품 1개뿐' });
  });
  it('다른 구성 상품은 대표 상품이 안 보여도 공개 상품끼리 보인다', () => {
    const other = view(['draft', 'public', 'public'], { kind: 'other_composition' });
    expect(other).toMatchObject({ shown: true, pages: 2, representativeOnly: false });
    expect(relationReadback(other, unsaved('other_composition'))).toBe("저장하면 상품 2개 상세에 보입니다. 상품 상세 구성의 '다른 구성 추천 표시'가 켜져 있어야 합니다.");
  });
  it('보이는 곳은 유형과 표시 방식에 따라 대표 상품 상세 한 곳이거나 상품마다다', () => {
    expect(relationReadback(view(['public', 'public', 'public'], { kind: 'together' }), unsaved('together'))).toBe('저장하면 대표 상품 상세에 보입니다.');
    expect(relationReadback(view(['public', 'public', 'public'], { kind: 'together', visual: true }), unsaved('together'))).toBe('저장하면 상품 3개 상세에 보입니다.');
    expect(relationReadback(view(['public', 'public', 'draft'], { kind: 'codi', visual: true }), saved('codi'))).toBe('지금 상품 2개 상세에 보입니다.');
    expect(relationListView(view(['public', 'public', 'public'], { kind: 'together' }))).toEqual({ shown: true, detail: '대표 상품 상세' });
  });
  it('전시 기간 전이면 시작 시각부터 보인다고 적는다', () => {
    const scheduled = view(['public', 'public'], { state: 'scheduled' });
    expect(relationReadback(scheduled, { ...unsaved(), startText: '12월 1일 10:00' })).toBe('저장하면 12월 1일 10:00부터 상품 2개 상세에 보입니다.');
    expect(relationReadback(scheduled, { ...saved(), startText: '12월 1일 10:00' })).toBe('12월 1일 10:00부터 상품 2개 상세에 보입니다.');
    expect(relationListView(scheduled)).toEqual({ shown: false, detail: '전시 기간 전 · 상품 2개 상세' });
  });
  it('판매 제한 상품은 성인 인증 고객에게만 보이는 범위를 적고, 보는 운영자와 상관없이 같은 결과다', () => {
    expect(relationReadback(view(['public', 'public', 'restricted']), unsaved())).toBe('저장하면 상품 3개 상세에 보입니다. 성인 상품 1개는 성인 인증 고객에게만 보입니다.');
    expect(relationReadback(view(['restricted', 'public', 'public']), unsaved())).toBe('저장하면 성인 인증 고객에게만 상품 3개 상세에 보입니다.');
    expect(relationReadback(view(['public', 'restricted']), saved())).toBe('지금 성인 인증 고객에게만 상품 2개 상세에 보입니다.');
    expect(relationListView(view(['public', 'public', 'restricted']))).toEqual({ shown: true, detail: '상품 3개 상세 · 1개는 성인 인증 고객에게만' });
    expect(relationListView(view(['public', 'restricted']))).toEqual({ shown: true, detail: '상품 2개 상세 · 성인 인증 고객에게만' });
  });
  it('성인 상품을 모든 고객에게 숨겨 둔 동안에는 판매 제한 상품을 세지 않는다', () => {
    expect(relationReadback(view(['public', 'restricted'], { adultGoodsHidden: true }), unsaved())).toBe('숨긴 성인 상품을 빼면 공개 상품이 1개뿐이라 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['restricted', 'public', 'public'], { adultGoodsHidden: true }), unsaved())).toBe('대표 상품이 모든 고객에게 숨긴 성인 상품이라 저장해도 고객에게 보이지 않습니다.');
    expect(relationReadback(view(['public', 'public', 'restricted'], { adultGoodsHidden: true }), unsaved())).toBe('저장하면 상품 2개 상세에 보입니다.');
    expect(relationListView(view(['public', 'restricted'], { adultGoodsHidden: true }))).toEqual({ shown: false, detail: '숨긴 성인 상품을 빼면 공개 상품 1개뿐' });
  });
});

describe('연관상품 전시 기간 되읽기(R6)', () => {
  const now = Date.parse('2026-11-25T03:00:00Z');
  it('입력한 기간을 한 줄로 읽고 올해가 아니면 연도를 붙인다', () => {
    const read = (startsAt: string, endsAt: string, enabled = true) => relationPeriodReadback({ enabled, startsAt, endsAt }, now);
    expect(read('', '')).toEqual({ text: '기간 없이 계속 전시합니다.', invalid: false, startText: null });
    expect(read('2026-12-01T10:00', '').text).toBe('12월 1일 10:00부터 계속 전시합니다.');
    expect(read('', '2026-12-07T23:59').text).toBe('12월 7일 23:59까지 전시합니다.');
    expect(read('2026-12-01T10:00', '2027-01-02T00:00')).toEqual({ text: '12월 1일 10:00부터 2027년 1월 2일 00:00까지 전시합니다.', invalid: false, startText: '12월 1일 10:00' });
    expect(read('', '', false).text).toBe('전시로 바꾸면 기간 없이 계속 전시합니다.');
  });
  it('종료가 시작보다 빠르거나 같으면 저장할 수 없다고 그 자리에서 알린다', () => {
    expect(relationPeriodReadback({ enabled: true, startsAt: '2026-12-02T10:00', endsAt: '2026-12-02T10:00' }, now)).toMatchObject({ invalid: true, text: '종료가 시작보다 늦어야 저장할 수 있습니다.' });
  });
  it('저장 전 게시 상태는 목록과 같은 순서로 판정한다(KST 입력)', () => {
    const state = (enabled: boolean, startsAt: string, endsAt: string) => relationDraftState({ enabled, startsAt, endsAt }, now);
    expect(state(false, '', '')).toBe('stopped');
    expect(state(true, '', '')).toBe('active');
    expect(state(true, '2026-11-25T12:01', '')).toBe('scheduled');
    expect(state(true, '2026-11-25T12:00', '')).toBe('active');
    expect(state(true, '', '2026-11-25T12:00')).toBe('ended');
    expect(state(true, '', '2026-11-25T12:01')).toBe('active');
  });
});

describe('연관상품 입력을 막거나 묻는 문구(R3·R4·R9·R10)', () => {
  it('한도가 줄어드는 유형은 몇 개를 빼야 하는지 적는다', () => {
    expect(relationLimitBlock('코디 상품', 5, 8)).toBe('코디 상품은 5개까지 담습니다. 지금 8개라 3개를 뺀 뒤 바꿀 수 있습니다.');
    expect(relationLimitBlock('코디 상품', 5, 5)).toBeNull();
  });
  it('사라지는 입력만 골라 한 문장으로 적는다', () => {
    expect(relationLossText({})).toBe('');
    expect(relationLossText({ image: false, tags: 0, text: false, labels: 0 })).toBe('');
    expect(relationLossText({ image: true, tags: 3 })).toBe('이미지 1장, 태그 3개가 사라집니다.');
    expect(relationLossText({ image: true })).toBe('이미지 1장이 사라집니다.');
    expect(relationLossText({ text: true, labels: 2 })).toBe('이미지 설명과 소개 글, 구성 표시값 2개가 사라집니다.');
  });
  it('저장할 수 없는 까닭을 하나씩 말한다', () => {
    const error = (patch: Record<string, unknown>) => { const result = parseGoodsRelationInput({ id, revision: 0, values: { ...values, ...patch } }); return result.ok ? null : result.error; };
    const visual = { imagePath: 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp', alt: '공간', description: '', hotspots: [] };
    expect(error({ title: ' ' })).toBe('노출 제목을 1~15자로 적어 주세요.');
    expect(error({ goodIds: ['good-a'] })).toBe('상품을 2개 이상 담아 주세요.');
    expect(error({ goodIds: Array.from({ length: 8 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0' })).toBe('상품은 6개까지 담을 수 있습니다. 2개를 뺀 뒤 다시 저장해 주세요.');
    expect(error({ representativeGoodId: 'good-c' })).toBe('담은 상품 가운데 대표 상품을 하나 골라 주세요.');
    expect(error({ kind: 'codi', visual: null })).toBe('코디 상품은 이미지가 있어야 합니다. 코디 이미지를 올려 주세요.');
    expect(error({ kind: 'codi', visual: { ...visual, imagePath: '' } })).toBe('코디 이미지를 올려 주세요.');
    expect(error({ visual: { ...visual, imagePath: '' } })).toBe('이미지형은 이미지가 있어야 합니다. 이미지를 올리거나 표시 방식을 목록형으로 바꿔 주세요.');
    expect(error({ visual: { ...visual, alt: ' ' } })).toBe('이미지 설명을 적어 주세요.');
    expect(error({ visual: { ...visual, hotspots: [{ goodId: 'good-z', x: 1, y: 1 }] } })).toBe('이미지를 저장하지 못했습니다. 이미지를 다시 올리고 태그를 다시 붙인 뒤 저장해 주세요.');
    expect(error({ endsAt: values.startsAt })).toBe('전시 기간의 종료를 시작보다 늦게 맞춰 주세요.');
  });
  it('다른 사람이 먼저 바꾼 저장은 문구가 아니라 값으로 가린다', () => {
    expect(goodsRelationConflict('goods_relation_changed')).toBe(true);
    expect(goodsRelationConflict('goods_relation_operation_conflict')).toBe(true);
    expect(goodsRelationConflict('invalid_goods_relation_goods')).toBe(false);
    expect(goodsRelationConflict(undefined)).toBe(false);
    expect(goodsRelationError('goods_relation_changed')).toContain('다른 사람이 먼저 바꿨습니다.');
    expect(goodsRelationError('goods_relation_changed')).toContain('[최신 내용 다시 열기]');
    for (const message of ['goods_relation_changed', 'goods_relation_operation_conflict', 'unverified_artwork', 'invalid_goods_relation_visual', 'invalid_goods_relation_goods', undefined]) {
      expect(goodsRelationError(message)).not.toMatch(/편성|요청|운영자/);
    }
  });
});
