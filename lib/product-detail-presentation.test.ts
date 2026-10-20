import { describe, expect, it } from 'vitest';
import { DEFAULT_DETAIL_PRESENTATION, isDetailDate, parseDetailSection, parseDetailSnapshot, parsePublicDetailPresentation } from './product-detail-presentation';
const banner = () => structuredClone(DEFAULT_DETAIL_PRESENTATION.banner);
describe('product detail presentation contracts', () => {
  it('requires complete visible banners, strict dates and bounded distinct targets', () => {
    const valid = { ...banner(), enabled: true, title: '혜택 안내', text: '상품상세 혜택입니다' };
    expect(parseDetailSection('banner', valid)).toEqual(valid);
    for (const patch of [{ title: '' }, { title: '12345678901' }, { text: 'a'.repeat(21) }, { style: null }, { text: 'bad\ntext' }, { targetType: 'goods', goodIds: [] }, { targetType: 'goods', goodIds: ['g1', 'g1'] }, { targetType: 'all', goodIds: ['g1'] }, { periodEnabled: true, startsOn: '2026-02-30', endsOn: '2026-03-01' }, { periodEnabled: true, startsOn: '2026-03-02', endsOn: '2026-03-01' }]) expect(parseDetailSection('banner', { ...valid, ...patch })).toBeNull();
    expect(parseDetailSection('banner', { ...valid, targetType: 'goods', goodIds: Array.from({ length: 200 }, (_, i) => `g${i}`) })).not.toBeNull();
    expect(parseDetailSection('banner', { ...valid, targetType: 'goods', goodIds: Array.from({ length: 201 }, (_, i) => `g${i}`) })).toBeNull();
    expect(isDetailDate('2028-02-29')).toBe(true); expect(isDetailDate('2027-02-29')).toBe(false);
  });
  it('lets a saved banner with subsequently deleted targets reopen for repair', () => {
    const values = { ...structuredClone(DEFAULT_DETAIL_PRESENTATION), banner: { ...banner(), enabled: true, title: '수정 대상', text: '삭제된 대상을 다시 선택', targetType: 'goods', goodIds: [] } };
    expect(parseDetailSnapshot({ values, revisions: { banner: 2, modules: 1, otherComposition: 0 } })).not.toBeNull();
    expect(parseDetailSection('banner', values.banner)).toBeNull();
  });
  it('rejects unknown module fields and mismatched public counts', () => {
    expect(parseDetailSection('modules', { ...DEFAULT_DETAIL_PRESENTATION.modules, bank: 'hidden' })).toBeNull();
    const value = { banner: null, reviews: { count: 0, positiveCount: 1, cards: [] }, recommendations: { similar: [], together: [], categoryPopular: [], storePopular: [] }, nextChangeAt: null };
    expect(parsePublicDetailPresentation(value)).toBeNull();
    expect(parsePublicDetailPresentation({ ...value, reviews: { count: 15, positiveCount: 12, cards: [] } })).not.toBeNull();
  });
  it('keeps the five legacy module keys and an independently versioned other-composition setting', () => {
    expect(Object.keys(DEFAULT_DETAIL_PRESENTATION.modules)).toEqual(['reviewSummary', 'similar', 'together', 'categoryPopular', 'storePopular']);
    expect(parseDetailSection('modules', { ...DEFAULT_DETAIL_PRESENTATION.modules, otherComposition: true })).toBeNull();
    expect(parseDetailSection('otherComposition', { enabled: true })).toEqual({ enabled: true });
    for (const invalid of [{}, { enabled: 1 }, { enabled: true, similar: true }]) expect(parseDetailSection('otherComposition', invalid)).toBeNull();
    const snapshot = { values: structuredClone(DEFAULT_DETAIL_PRESENTATION), revisions: { banner: 9, modules: 13, otherComposition: 2 } };
    expect(parseDetailSnapshot(snapshot)).toEqual(snapshot);
    expect(parseDetailSnapshot({ ...snapshot, revisions: { banner: 9, modules: 13 } })).toBeNull();
  });
});
