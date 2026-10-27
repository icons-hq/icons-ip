import { describe, expect, it } from 'vitest';
import {
  COLLECTION_BANNER_SLIDE_LIMIT,
  collectionBannerDisplayLimit,
  collectionBannersNeedCardRewardGate,
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
  const banner = (id: string, slot: CollectionBanner['slot'], endsAt: number | null = null, href: string | null = null): CollectionBanner => ({
    id, slot, title: id, subtitle: null, imageUrl: id, mobileImageUrl: null, href, imageAlt: '', imageDim: 'none', textColor: 'black', endsAt,
  });
  const OPEN = { cardRewardsEnabled: true, communityEnabled: true };
  const CLOSED = { cardRewardsEnabled: false, communityEnabled: false };

  it('요청 시각에 끝난 배너와 다른 슬롯을 거르고 운영 순서를 지킨다', () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    const banners = [banner('a', 'all'), banner('b', 'best'), banner('c', 'all', now), banner('d', 'all', now + 1)];

    expect(liveCollectionBanners(banners, 'all', now, OPEN).map((item) => item.id)).toEqual(['a', 'd']);
    expect(liveCollectionBanners(banners, 'best', now, OPEN).map((item) => item.id)).toEqual(['b']);
    expect(liveCollectionBanners(banners, 'new', now, OPEN)).toEqual([]);
  });

  it(`굿즈샵 전체는 ${COLLECTION_BANNER_SLIDE_LIMIT}장, BEST·NEW는 운영 순서 첫 장 하나만 그린다(l8b-data-1)`, () => {
    const all = Array.from({ length: 12 }, (_, index) => banner(`s${index}`, 'all'));
    const best = [banner('b1', 'best'), banner('b2', 'best')];

    expect(liveCollectionBanners(all, 'all', 0, OPEN)).toHaveLength(COLLECTION_BANNER_SLIDE_LIMIT);
    expect(liveCollectionBanners(best, 'best', 0, OPEN).map((item) => item.id)).toEqual(['b1']);
    expect(collectionBannerDisplayLimit('all')).toBe(COLLECTION_BANNER_SLIDE_LIMIT);
    expect(collectionBannerDisplayLimit('best')).toBe(1);
    expect(collectionBannerDisplayLimit('new')).toBe(1);
  });

  it('꺼진 목적지(카드팩·게임·커뮤니티)를 걸러낸 뒤에 자르므로 빠진 자리는 다음 장이 채운다(l8b-data-4)', () => {
    const best = [banner('packs', 'best', null, '/packs'), banner('next', 'best', null, '/shop/best')];
    const all = [banner('games', 'all', null, '/games'), banner('community', 'all', null, '/community'),
      ...Array.from({ length: 10 }, (_, index) => banner(`s${index}`, 'all'))];

    expect(liveCollectionBanners(best, 'best', 0, CLOSED).map((item) => item.id)).toEqual(['next']);
    expect(liveCollectionBanners(best, 'best', 0, OPEN).map((item) => item.id)).toEqual(['packs']);
    const slides = liveCollectionBanners(all, 'all', 0, CLOSED);
    expect(slides).toHaveLength(10);
    expect(slides.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, index) => `s${index}`));
  });

  it('카드 리워드 게이트는 이 슬롯의 노출 중 배너가 카드팩·게임으로 갈 때만 읽는다', () => {
    const now = 100;
    const banners = [banner('shop', 'best', null, '/shop/best'), banner('packs', 'all', null, '/packs'), banner('ended', 'new', now, '/games')];

    expect(collectionBannersNeedCardRewardGate(banners, 'best', now)).toBe(false);
    expect(collectionBannersNeedCardRewardGate(banners, 'all', now)).toBe(true);
    expect(collectionBannersNeedCardRewardGate(banners, 'new', now)).toBe(false);
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
