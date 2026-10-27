import { describe, expect, it } from 'vitest';
import {
  COLLECTION_BANNER_SLIDE_LIMIT,
  liveCollectionBanners,
  parseCollectionBannerRow,
  wrapCollectionBannerIndex,
  type CollectionBanner,
  type CollectionBannerRow,
} from './collection-banners';

const PC = 'public-media/catalog/curation/97410000-0000-4000-8000-000000000001.webp';
const MO = 'public-media/catalog/curation/97410000-0000-4000-8000-000000000002.webp';
const url = (path: string) => `https://cdn.test/${path}`;

function row(overrides: Partial<CollectionBannerRow> = {}): CollectionBannerRow {
  return {
    id: '97420000-0000-4000-8000-000000000001',
    title: '가을 신상 굿즈',
    image_path: PC,
    link_path: null,
    slot: 'all',
    active_to: null,
    payload: null,
    ...overrides,
  };
}

describe('parseCollectionBannerRow', () => {
  it('최소 행은 잉크 글자·딤 없음·장식 이미지로 읽는다', () => {
    expect(parseCollectionBannerRow(row(), url)).toEqual({
      id: '97420000-0000-4000-8000-000000000001',
      slot: 'all',
      title: '가을 신상 굿즈',
      subtitle: null,
      imageUrl: `https://cdn.test/${PC}`,
      mobileImageUrl: null,
      href: null,
      imageAlt: '',
      imageDim: 'none',
      textColor: 'black',
      endsAt: null,
    });
  });

  it('선택 칸(부제·모바일 이미지·대체텍스트·스타일·링크·종료)을 그대로 싣는다', () => {
    const banner = parseCollectionBannerRow(row({
      slot: 'best',
      link_path: '/shop/best',
      active_to: '2026-11-01T00:00:00.000Z',
      payload: { subtitle: '지금 많이 찾는 굿즈', mobile_image_path: MO, image_alt: '리락쿠마 키링 세 종', image_dim: 'black', text_color: 'white' },
    }), url);

    expect(banner).toMatchObject({
      slot: 'best', href: '/shop/best', subtitle: '지금 많이 찾는 굿즈', mobileImageUrl: `https://cdn.test/${MO}`,
      imageAlt: '리락쿠마 키링 세 종', imageDim: 'black', textColor: 'white', endsAt: Date.parse('2026-11-01T00:00:00.000Z'),
    });
  });

  it.each([
    ['알 수 없는 슬롯', { slot: 'category' }],
    ['슬롯 없음', { slot: null }],
    ['빈 제목', { title: '' }],
    ['41자 제목', { title: '가'.repeat(41) }],
    ['줄바꿈 제목', { title: '두 줄\n제목' }],
    ['앞뒤 공백 제목', { title: ' 제목 ' }],
    ['이미지 없음', { image_path: null }],
    ['정적 경로 이미지', { image_path: '/generated/banner.webp' }],
    ['외부 링크', { link_path: '//evil.test' }],
    ['모르는 payload 키', { payload: { badge: 'NEW' } }],
    ['81자 부제', { payload: { subtitle: '가'.repeat(81) } }],
    ['101자 대체텍스트', { payload: { image_alt: '가'.repeat(101) } }],
    ['문자열이 아닌 대체텍스트', { payload: { image_alt: 7 } }],
    ['잘못된 모바일 이미지', { payload: { mobile_image_path: '/generated/m.webp' } }],
    ['잘못된 글자색', { payload: { text_color: 'pink' } }],
    ['잘못된 딤', { payload: { image_dim: 'grey' } }],
  ])('%s 행은 그리지 않는다', (_label, overrides) => {
    expect(parseCollectionBannerRow(row(overrides as Partial<CollectionBannerRow>), url)).toBeNull();
  });
});

describe('liveCollectionBanners', () => {
  const banner = (id: string, slot: CollectionBanner['slot'], endsAt: number | null = null): CollectionBanner => ({
    id, slot, title: id, subtitle: null, imageUrl: id, mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black', endsAt,
  });

  it('요청 시각에 끝난 배너와 다른 슬롯을 거르고 운영 순서를 지킨다', () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    const banners = [banner('a', 'all'), banner('b', 'best'), banner('c', 'all', now), banner('d', 'all', now + 1)];

    expect(liveCollectionBanners(banners, 'all', now).map((item) => item.id)).toEqual(['a', 'd']);
    expect(liveCollectionBanners(banners, 'best', now).map((item) => item.id)).toEqual(['b']);
    expect(liveCollectionBanners(banners, 'new', now)).toEqual([]);
  });

  it(`한 페이지는 ${COLLECTION_BANNER_SLIDE_LIMIT}장까지만 그린다`, () => {
    const banners = Array.from({ length: 12 }, (_, index) => banner(`s${index}`, 'all'));

    expect(liveCollectionBanners(banners, 'all', 0)).toHaveLength(COLLECTION_BANNER_SLIDE_LIMIT);
  });
});

describe('wrapCollectionBannerIndex', () => {
  it('처음 앞은 마지막, 마지막 다음은 처음이다(레퍼런스 loop)', () => {
    expect(wrapCollectionBannerIndex(-1, 6)).toBe(5);
    expect(wrapCollectionBannerIndex(6, 6)).toBe(0);
    expect(wrapCollectionBannerIndex(3, 6)).toBe(3);
    expect(wrapCollectionBannerIndex(4, 0)).toBe(0);
  });
});
