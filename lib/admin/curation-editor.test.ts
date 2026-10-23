import { describe, expect, it } from 'vitest';
import { buildDraftCurationPreview, createCurationEditorValues, curationKstInput, moveCurationProduct } from './curation-editor';
import type { HomeGoodsCard } from '@/lib/home-catalog';

const card: HomeGoodsCard = { id: 'g1', name: '실제 상품', brand: 'ICONS', price: 12000, badge: null, imageBg: 'url("/goods.webp")', href: '/shop/g1', soldOut: false };

describe('curation editor preview', () => {
  it('new banners preview explicit defaults while legacy option absence remains absent', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z'), title: '스타일', imageUrl: '/pc.webp' };
    expect(values).toMatchObject({ imageDim: 'none', textColor: 'white' });
    expect(buildDraftCurationPreview('draft', { ...values, imageDim: 'white', textColor: 'black' }, []).curation.heroSlides[0]).toMatchObject({ imageDim: 'white', textColor: 'black' });
    expect(buildDraftCurationPreview('draft', { ...values, imageDim: '', textColor: '' }, []).curation.heroSlides[0]).toMatchObject({ imageDim: undefined, textColor: undefined });
  });
  it('previews free products after eligibility filtering without changing the saved pool or BEST tabs', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'product_collection'), title: '자유상품',
      productLayout: 'full_image' as const, productImageShape: 'landscape' as const, productItemCount: '1', goodIds: ['hidden', 'g1', 'later'] };
    const result = buildDraftCurationPreview('draft', values, [card]);
    expect(result.curation.productCollections?.[0]).toMatchObject({ title: '자유상품', layout: 'full_image', imageShape: 'landscape', goods: [card] });
    expect(result.curation.categoryBestTabs).toEqual([]);
    expect(result.missingGoodIds).toEqual(['hidden', 'later']);
    expect(values.goodIds).toEqual(['hidden', 'g1', 'later']);
    expect(buildDraftCurationPreview('draft', { ...values, productItemCount: '12' }, [card]).curation.productCollections).toBeUndefined();
  });
  it('제목 없는 이미지 배너도 미리보기하며 링크 없음과 별도 이미지 설명을 전달한다', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z'), title: '', imageUrl: '/pc.webp', linkPath: '', altEnabled: true, altTitle: '이미지 제목', altContent: '이미지 내용' };
    expect(buildDraftCurationPreview('draft', values, []).curation.heroSlides[0]).toMatchObject({ title: '', href: null, imageAlt: '이미지 제목 · 이미지 내용' });
    expect(buildDraftCurationPreview('draft', { ...values, altEnabled: false }, []).curation.heroSlides[0].imageAlt).toBe('');
  });
  it('자동 선정은 저장된 수동 목록 대신 공개 카탈로그의 최신 상품과 개수를 사용한다', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'best_tab'), title: '신상품', selectionMode: 'latest' as const, itemCount: '3', goodIds: ['old'] };
    const latest = Array.from({ length: 5 }, (_, index) => ({ ...card, id: `new-${index}` }));
    expect(buildDraftCurationPreview('draft', values, [card], latest).curation.categoryBestTabs[0].goods).toEqual(latest.slice(0, 3));
  });

  it('모바일·PC 이미지와 입력 중인 제목을 공개 히어로 계약으로 전달한다', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z'), title: '신상품', subtitle: '이번 주', imageUrl: '/pc.webp', mobileImageUrl: '/mobile.webp' };
    const result = buildDraftCurationPreview('draft', values, []);
    expect(result.curation.heroSlides).toEqual([{ id: 'draft', title: '신상품', subtitle: '이번 주', imageUrl: '/pc.webp', mobileImageUrl: '/mobile.webp', href: '/', imageAlt: '', imageDim: 'none', textColor: 'white' }]);
  });

  it('상품 순서를 지키고 없는 상품·중복을 가짜 카드로 채우지 않는다', () => {
    const second = { ...card, id: 'g2', name: '두 번째', href: '/shop/g2', soldOut: true };
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'best_tab'), title: '추천', slot: 'popular', goodIds: ['g2', 'missing', 'g1', 'g2'] };
    const result = buildDraftCurationPreview('draft', values, [card, second]);
    expect(result.curation.popularTabs[0].goods).toEqual([second, card]);
    expect(result.curation.categoryBestTabs).toEqual([]);
    expect(result.missingGoodIds).toEqual(['missing']);
  });

  it('모바일 띠배너는 공개 셸 계약으로 분리하고 본문 배너로 만들지 않는다', () => {
    const values = { ...createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'notice_strip'), title: '공지', imageUrl: '/strip.webp', mobileImageUrl: '/strip-mobile.webp' };
    const result = buildDraftCurationPreview('draft', values, []);
    expect(result.noticeStrip?.mobileImageUrl).toBe('/strip-mobile.webp');
    expect(result.curation.heroSlides).toEqual([]);
  });

  it('텍스트 공지 바는 버튼 없이·모든 화면에서 시작하고, 링크와 버튼 문구가 함께일 때만 버튼을 미리보기한다', () => {
    const values = createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'notice_bar');
    expect(values).toMatchObject({ linkPath: '', ctaLabel: '자세히 보기', pageTypes: ['home', 'collection', 'product', 'content', 'other'] });
    const draft = buildDraftCurationPreview('draft', { ...values, kind: 'notice_bar', title: '배송 일정 안내' }, []);
    expect(draft.noticeBar).toEqual({ id: 'draft', key: 'draft', message: '배송 일정 안내', cta: null, pageTypes: values.pageTypes });
    expect(buildDraftCurationPreview('draft', { ...values, kind: 'notice_bar', title: '배송 일정 안내', linkPath: '/events' }, []).noticeBar?.cta)
      .toEqual({ label: '자세히 보기', href: '/events' });
    expect(buildDraftCurationPreview('draft', { ...values, kind: 'notice_bar', title: '', linkPath: '/events' }, []).noticeBar).toBeNull();
    expect(draft.curation.heroSlides).toEqual([]);
  });

  it('새 띠배너는 상품 목록을 빼고 시작하고, 대상 없이 저장된 기존 띠배너는 모든 화면으로 보인다', () => {
    expect(createCurationEditorValues(null, '2026-10-12T00:00:00Z', 'notice_strip').pageTypes).toEqual(['home', 'product', 'content', 'other']);
    const legacy = { id: 'strip', kind: 'notice_strip' as const, ipId: null, title: '기존', imagePath: null, imageUrl: null, mobileImageUrl: null,
      linkPath: '/events', displayOrder: 0, activeFrom: '2026-10-01T00:00:00Z', activeTo: null, enabled: true, slot: null, payload: null,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', status: 'active' as const };
    expect(createCurationEditorValues(legacy, '2026-10-12T00:00:00Z').pageTypes).toEqual(['home', 'collection', 'product', 'content', 'other']);
    expect(createCurationEditorValues({ ...legacy, payload: { page_types: ['product'] } }, '2026-10-12T00:00:00Z').pageTypes).toEqual(['product']);
  });

  it('상품 목록 이동은 경계에서 그대로이고 선택 배열을 변경하지 않는다', () => {
    const ids = ['g1', 'g2', 'g3'];
    expect(moveCurationProduct(ids, 1, -1)).toEqual(['g2', 'g1', 'g3']);
    expect(moveCurationProduct(ids, 2, 1)).toEqual(ids);
    expect(ids).toEqual(['g1', 'g2', 'g3']);
  });

  it('빈 필수값에는 가짜 배너를 표시하지 않고 일정은 KST로 편집한다', () => {
    const values = createCurationEditorValues(null, '2026-10-12T00:00:00Z');
    expect(buildDraftCurationPreview('draft', values, []).curation.heroSlides).toEqual([]);
    expect(values.activeFrom).toBe('2026-10-12T09:00');
    expect(curationKstInput('invalid')).toBe('');
  });
});
