import { describe, expect, it } from 'vitest';
import { CAMPAIGN_PRESENTATION_MESSAGES, normalizeCampaignPresentationInput, parseCampaignPresentationRow } from './campaign-presentation';
import { defaultCategoryDisplayValues, parseCategoryDisplayValues } from './category-display';
import { parseCollectionBannerRow, type CollectionBannerRow } from './collection-banners';
import { safeShoppingStoryLink } from './shopping-stories-content';

/* 개편 리뷰(review-c m2) — 공용 링크 검증 isSafeInternalLink 를 쓰는 링크 칸이 점 조각 경로(`/..//evil.example` 등)를 같이 거절한다.
   홈 큐레이션(catalog.test)·공지 스트립/바(notice-strip.server.test)는 각자의 시험에서 본다. 규칙 자체는 home-catalog.test 몫이다. */
const DOTTED = ['/..//evil.example', '/.//evil.example', '/%2e%2e//evil.example', '/a/..//evil.example', '/a/./b'];

describe('공용 링크 검증을 쓰는 링크 칸은 점 조각 경로를 거절한다', () => {
  it('쇼핑 스토리 본문 링크', () => {
    expect(safeShoppingStoryLink('/shop/new')).toBe(true);
    for (const link of DOTTED) expect(safeShoppingStoryLink(link), link).toBe(false);
  });

  it('컬렉션 배너 링크(행을 그리지 않는다)', () => {
    const row = (link_path: string): CollectionBannerRow => ({
      id: '97420000-0000-4000-8000-000000000001', title: '가을 신상 굿즈',
      image_path: 'public-media/catalog/curation/97410000-0000-4000-8000-000000000001.webp', link_path, slot: 'all', active_to: null, payload: null,
    });
    const url = (path: string) => `https://cdn.test/${path}`;
    expect(parseCollectionBannerRow(row('/shop/best'), url)?.href).toBe('/shop/best');
    for (const link of DOTTED) expect(parseCollectionBannerRow(row(link), url), link).toBeNull();
  });

  it('카테고리 전시 배너 링크(저장 값을 읽지 않는다)', () => {
    const values = (linkPath: string) => {
      const base = defaultCategoryDisplayValues('92930000-0000-4000-8000-000000000001');
      return { ...base, banner: { ...base.banner, linkPath } };
    };
    expect(parseCategoryDisplayValues(values('/shop/new'))).not.toBeNull();
    for (const link of DOTTED) expect(parseCategoryDisplayValues(values(link)), link).toBeNull();
  });

  it('캠페인 카드 바로가기(DB 행 읽기·어드민 입력 정규화 둘 다)', () => {
    expect(parseCampaignPresentationRow({ card_link_path: '/shop/new' })?.cardLinkPath).toBe('/shop/new');
    for (const link of DOTTED) {
      expect(parseCampaignPresentationRow({ card_link_path: link }), link).toBeNull();
      expect(normalizeCampaignPresentationInput({ popupMode: '', popupLocation: '', cardLinkPath: link }), link)
        .toEqual({ ok: false, errors: { cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat } });
    }
  });
});
