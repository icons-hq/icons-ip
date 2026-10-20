import { useEffect, useState } from 'react';
import { CurationScreen } from '../../components/admin/screens/CurationScreen';
import type { AdminCurationKind } from '../../lib/admin/curations';
import type { AdminCurationRecord } from '../../lib/admin/curations.server';
import { buildDraftCurationPreview, createCurationEditorValues, emptyCurationPreview, type CurationPublicPreview } from '../../lib/admin/curation-editor';
import { parseHomeLayoutBlocks, resolveHomeLayoutBlocks } from '../../lib/home-layout';
import type { AdminHomeLayout } from '../../lib/admin/home-layout';
import type { HomeGoodsCard } from '../../lib/home-catalog';
import type { HomeProductRankings } from '../../lib/home-ranking';
import type { HomeRankingBlockKey } from '../../lib/home-layout';

function fixtureImage(label: string, width: number, height: number, color: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width * .75}" cy="${height * .4}" r="${height * .2}" fill="#fff" opacity=".4"/><text x="10%" y="55%" fill="#fff" font-family="sans-serif" font-size="${width / 18}">${label}</text></svg>`)}`;
}
const pcImage = fixtureImage('PC preview', 1212, 655, '#466e72');
const mobileImage = fixtureImage('Mobile preview', 390, 468, '#816150');
const base: AdminCurationRecord = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'hero', title: '합성 프로모션 배너', ipId: null,
  imagePath: 'public-media/catalog/curation/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', imageUrl: pcImage, mobileImageUrl: mobileImage,
  linkPath: '/shop', displayOrder: 0, activeFrom: '2026-10-01T00:00:00Z', activeTo: null, enabled: true,
  slot: null, payload: { subtitle: '기기별 이미지와 편집 내용 검수', mobile_image_path: 'public-media/catalog/curation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', status: 'active',
};
const kinds: AdminCurationKind[] = ['hero', 'editor_pick', 'band_banner', 'best_tab', 'benefit', 'notice_strip', 'announcement', 'featured_ip', 'sales_best', 'review_best'];
const records = kinds.map((kind, index): AdminCurationRecord => ({
  ...base, kind, id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
  title: `${['프로모션 배너', '추천 콘텐츠', '기획전 배너', '상품 모음', '혜택 타일', '상단 띠배너', '공지 배너', '특집 IP', '판매량 BEST', '베스트리뷰'][index]} 검수`,
  ipId: kind === 'featured_ip' ? 'fixture-ip' : null,
  slot: kind === 'best_tab' ? 'category' : null,
  payload: kind === 'sales_best' ? { exposure_mode: 'all', period: 'weekly' }
    : kind === 'review_best' ? { selection_mode: 'rating' }
      : kind === 'best_tab' || kind === 'band_banner' ? { good_ids: ['fixture-good-1', 'fixture-good-2'], subcopy: '기획전 설명' } : base.payload,
}));
const goods: HomeGoodsCard[] = Array.from({ length: 25 }, (_, index) => ({
  id: `fixture-good-${index + 1}`, name: `합성 상품 ${index + 1} — 긴 상품 제목의 줄바꿈과 선택 순서 검수`,
  brand: '합성 IP', price: 10000 + index * 1000, badge: null,
  imageBg: `url("${fixtureImage(`Product ${index + 1}`, 160, 160, index % 2 ? '#767068' : '#61765b')}")`,
  href: `/shop/fixture-good-${index + 1}`, soldOut: index === 3,
}));
const productRankings: HomeProductRankings = {
  salesAvailable: true, reviewsAvailable: true,
  sales: { realtime: ['fixture-good-4', 'fixture-good-3'], daily: ['fixture-good-2', 'fixture-good-1'], weekly: ['fixture-good-7', 'fixture-good-8', 'fixture-good-1', 'fixture-good-6'], monthly: ['fixture-good-9', 'fixture-good-1', 'fixture-good-2', 'fixture-good-3'] },
  reviewStatistics: goods.slice(0, 12).map((good, index) => ({
    goodId: good.id, ratingAverage: index === 3 ? 2.8 : 4.9 - index / 10, reviewCount: 12 + index,
    recentReviewAt: index === 2 ? null : '2026-10-11T00:00:00Z',
    representative: { id: `fixture-review-${index}`, rating: 5, body: '합성 검수 후기입니다. 실제 구매자 데이터가 아니며 긴 후기의 줄바꿈과 모바일 상품 카드 배치를 확인합니다.', authorName: `합성 작성자 ${index + 1}`, createdAt: '2026-10-10T00:00:00Z' },
  })),
};
const curation = records.reduce((current, record) => {
  const next = buildDraftCurationPreview(record.id, createCurationEditorValues(record, record.activeFrom), goods, [], productRankings).curation;
  return { ...current, heroSlides: [...current.heroSlides, ...next.heroSlides], editorPicks: [...current.editorPicks, ...next.editorPicks], goodsBands: [...current.goodsBands, ...next.goodsBands], categoryBestTabs: [...current.categoryBestTabs, ...next.categoryBestTabs], popularTabs: [...current.popularTabs, ...next.popularTabs], benefitTiles: [...current.benefitTiles, ...next.benefitTiles], salesBestBands: [...(current.salesBestBands ?? []), ...(next.salesBestBands ?? [])], reviewBestBands: [...(current.reviewBestBands ?? []), ...(next.reviewBestBands ?? [])] };
}, emptyCurationPreview());
const rankingKeys: HomeRankingBlockKey[] = [
  ...(curation.salesBestBands ?? []).map((band): HomeRankingBlockKey => `sales:${band.id}`),
  ...(curation.reviewBestBands ?? []).map((band): HomeRankingBlockKey => `reviews:${band.id}`),
];
const preview: CurationPublicPreview = {
  curation,
  noticeStrip: null, goods, latestGoods: [...goods].reverse().slice(0, 10), productRankings, cardRewardsEnabled: true,
};

export function StoreEditorFixture() {
  const [submitted, setSubmitted] = useState<Record<string, string>>({});
  const [homeLayout, setHomeLayout] = useState<AdminHomeLayout>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('icons-fixture-home-layout') ?? 'null');
      if (saved && parseHomeLayoutBlocks(saved.blocks)) return saved;
    } catch { /* An empty fixture starts in the legacy default order. */ }
    return { blocks: null, revision: 0, updatedAt: '2026-10-12T00:00:00Z' };
  });
  useEffect(() => {
    const listener = (event: Event) => setSubmitted((event as CustomEvent<Record<string, string>>).detail);
    window.addEventListener('store-fixture-submission', listener);
    const layoutListener = (event: Event) => setHomeLayout((event as CustomEvent<AdminHomeLayout>).detail);
    window.addEventListener('store-fixture-layout-saved', layoutListener);
    return () => { window.removeEventListener('store-fixture-submission', listener); window.removeEventListener('store-fixture-layout-saved', layoutListener); };
  }, []);
  return <>
    <CurationScreen
      draftActiveFrom="2026-10-12T00:00:00Z" draftId="99999999-9999-4999-8999-999999999999"
      eventOptions={[]} goodOptions={goods.map((good) => ({ id: good.id, title: good.name, archivedAt: null }))}
      ipOptions={[{ id: 'fixture-ip', title: '합성 IP', archivedAt: null }]} operationId="88888888-8888-4888-8888-888888888888"
      homeLayout={homeLayout} homeLayoutOperationId="77777777-7777-4777-8777-777777777777"
      preview={{ ...preview, curation: { ...preview.curation, layoutOrder: homeLayout.blocks === null ? null : resolveHomeLayoutBlocks(homeLayout.blocks, curation.goodsBands.map((band) => band.id), rankingKeys).filter((block) => block.enabled).map((block) => block.key) } }} records={records}
    />
    <details><summary>합성 제출 값</summary><pre>{JSON.stringify(submitted, null, 2)}</pre></details>
  </>;
}
