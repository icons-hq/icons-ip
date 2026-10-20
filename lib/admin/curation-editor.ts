import { buildHomeMosaicBand, emptyHomeMosaicSlots, parseHomeMosaicPayload, type HomeMosaicSlot } from '@/lib/home-mosaic';
import { buildHomeProductCollectionBand, isHomeProductImageShape, isHomeProductLayout, parseHomeProductCollectionPayload, type HomeProductImageShape, type HomeProductLayout } from '@/lib/home-product-collection';
import type { AdminCurationKind } from './curations';
import type { AdminCurationRecord } from './curations.server';
import type { HomeCurationSnapshot, HomeGoodsCard, NoticeStrip } from '@/lib/home-catalog';
import { imageBg } from '@/lib/media';
import { homeHeroAltText, homeHeroStyle, normalizeHeroNewlines, type HomeHeroImageDim, type HomeHeroTextColor } from '@/lib/home-hero';
import { buildHomeReviewBestBand, buildHomeSalesBestBand, emptyHomeProductRankings, isHomeSalesPeriod, selectHomeReviewGoods, type HomeProductRankings, type HomeSalesPeriod } from '@/lib/home-ranking';

export const CURATION_KIND_LABELS: Record<AdminCurationKind, string> = {
  hero: '프로모션 배너',
  notice_strip: '상단 띠배너',
  editor_pick: '추천 콘텐츠',
  band_banner: '기획전 배너',
  best_tab: '상품 모음',
  sales_best: '판매량 BEST',
  review_best: '베스트리뷰 상품',
  product_mosaic: '자유상품 모자이크',
  product_collection: '자유상품 리스트·풀이미지',
  benefit: '혜택 타일',
  featured_ip: '특집 IP',
  announcement: '공지 배너',
};

export const CURATION_KIND_ORDER: AdminCurationKind[] = [
  'notice_strip', 'hero', 'editor_pick', 'best_tab', 'sales_best', 'review_best', 'product_collection', 'product_mosaic', 'band_banner', 'benefit', 'featured_ip', 'announcement',
];

export const CURATION_STATUS_LABELS: Record<AdminCurationRecord['status'], string> = {
  active: '노출 중', scheduled: '노출 예정', ended: '종료', inactive: '비노출',
};

export interface CurationEditorValues {
  kind: AdminCurationKind;
  title: string;
  ipId: string;
  linkPath: string;
  displayOrder: string;
  activeFrom: string;
  activeTo: string;
  enabled: boolean;
  slot: string;
  subtitle: string;
  altEnabled: boolean;
  altTitle: string;
  altContent: string;
  imageDim: HomeHeroImageDim | '';
  textColor: HomeHeroTextColor | '';
  badge: string;
  description: string;
  subcopy: string;
  goodIds: string[];
  selectionMode: 'manual' | 'latest';
  itemCount: string;
  salesExposure: 'single' | 'all';
  salesPeriod: HomeSalesPeriod;
  reviewSelectionMode: 'rating' | 'manual';
  mosaicTitle: string;
  mosaicSubtitle: string;
  mosaicSlots: HomeMosaicSlot[];
  mosaicImageUrls: (string | null)[];
  productLayout: HomeProductLayout;
  productImageShape: HomeProductImageShape;
  productItemCount: string;
  imagePath: string;
  mobileImagePath: string;
  imageUrl: string | null;
  mobileImageUrl: string | null;
}

export interface CurationPublicPreview {
  curation: HomeCurationSnapshot;
  noticeStrip: NoticeStrip | null;
  goods: HomeGoodsCard[];
  latestGoods?: HomeGoodsCard[];
  productRankings?: HomeProductRankings;
  cardRewardsEnabled: boolean;
}

export function curationKstInput(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

export function curationPayloadText(record: AdminCurationRecord | null, key: string) {
  const value = record?.payload?.[key];
  return typeof value === 'string' ? value : '';
}

export function createCurationEditorValues(
  record: AdminCurationRecord | null,
  draftActiveFrom: string,
  initialKind: AdminCurationKind = 'hero',
): CurationEditorValues {
  const rawIds = record?.payload?.good_ids;
  return {
    kind: record?.kind ?? initialKind,
    title: record?.title ?? '',
    ipId: record?.ipId ?? '',
    linkPath: record ? record.linkPath ?? '' : '/',
    displayOrder: String(record?.displayOrder ?? 0),
    activeFrom: curationKstInput(record?.activeFrom ?? draftActiveFrom),
    activeTo: curationKstInput(record?.activeTo ?? null),
    enabled: record?.enabled ?? true,
    slot: record?.slot ?? 'category',
    subtitle: normalizeHeroNewlines(curationPayloadText(record, 'subtitle')),
    altEnabled: record?.payload?.alt_enabled === true,
    altTitle: curationPayloadText(record, 'alt_title'),
    altContent: normalizeHeroNewlines(curationPayloadText(record, 'alt_content')),
    imageDim: record ? homeHeroStyle(record.payload).imageDim ?? '' : 'none',
    textColor: record ? homeHeroStyle(record.payload).textColor ?? '' : 'white',
    badge: curationPayloadText(record, 'badge'),
    description: curationPayloadText(record, 'description'),
    subcopy: curationPayloadText(record, 'subcopy'),
    goodIds: Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string') : [],
    selectionMode: record?.payload?.selection_mode === 'latest' ? 'latest' : 'manual',
    itemCount: String(record?.payload?.item_count ?? 6),
    salesExposure: record?.payload?.exposure_mode === 'all' ? 'all' : 'single',
    salesPeriod: isHomeSalesPeriod(record?.payload?.period) ? record.payload.period : 'weekly',
    reviewSelectionMode: record?.payload?.selection_mode === 'manual' ? 'manual' : 'rating',
    mosaicTitle: curationPayloadText(record, 'mosaic_title'),
    mosaicSubtitle: curationPayloadText(record, 'mosaic_subtitle'),
    mosaicSlots: parseHomeMosaicPayload(record?.payload)?.slots ?? emptyHomeMosaicSlots(),
    mosaicImageUrls: record?.mosaicImageUrls ?? Array.from({ length: 8 }, () => null),
    productLayout: isHomeProductLayout(record?.payload?.layout) ? record.payload.layout : 'list',
    productImageShape: isHomeProductImageShape(record?.payload?.image_shape) ? record.payload.image_shape : 'square',
    productItemCount: String(record?.kind === 'product_collection' ? record.payload?.item_count ?? 8 : 8),
    imagePath: record?.imagePath ?? '',
    mobileImagePath: curationPayloadText(record, 'mobile_image_path'),
    imageUrl: record?.imageUrl ?? null,
    mobileImageUrl: record?.mobileImageUrl ?? null,
  };
}

export function moveCurationProduct(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids];
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function emptyCurationPreview(): HomeCurationSnapshot {
  return {
    hero: null, announcement: null, featuredIpIds: [], heroSlides: [], editorPicks: [],
    goodsBands: [], categoryBestTabs: [], popularTabs: [], benefitTiles: [],
  };
}

/** Drafts use the public Home view models and renderer; no fabricated catalog cards. */
export function buildDraftCurationPreview(
  id: string,
  values: CurationEditorValues,
  publicGoods: readonly HomeGoodsCard[],
  latestGoods: readonly HomeGoodsCard[] = [],
  productRankings: HomeProductRankings = emptyHomeProductRankings(),
): { curation: HomeCurationSnapshot; noticeStrip: NoticeStrip | null; missingGoodIds: string[]; reviewEligibleCount: number } {
  const curation = emptyCurationPreview();
  const title = values.title.trim();
  const href = values.linkPath;
  const goodsById = new Map(publicGoods.map((good) => [good.id, good]));
  const selectedIds = [...new Set(values.goodIds)];
  const goods = selectedIds.flatMap((goodId) => {
    const good = goodsById.get(goodId);
    return good ? [good] : [];
  });
  let noticeStrip: NoticeStrip | null = null;
  let reviewEligibleCount = 0;

  if (title || values.kind === 'hero') {
    switch (values.kind) {
      case 'hero':
        if (values.imageUrl) curation.heroSlides = [{
          id, title, href: href || null, imageUrl: values.imageUrl,
          mobileImageUrl: values.mobileImageUrl, subtitle: values.subtitle || null,
          imageAlt: homeHeroAltText({ alt_enabled: values.altEnabled, alt_title: values.altTitle, alt_content: values.altContent }),
          ...homeHeroStyle({ image_dim: values.imageDim, text_color: values.textColor }),
        }];
        break;
      case 'notice_strip':
        if (values.imageUrl) noticeStrip = {
          id, title, href, imageUrl: values.imageUrl, mobileImageUrl: values.mobileImageUrl,
        };
        break;
      case 'editor_pick':
        if (values.imageUrl) curation.editorPicks = [{
          id, title, href, imageBg: imageBg(values.imageUrl),
          badge: values.badge || null, description: values.description || null,
        }];
        break;
      case 'band_banner':
        if (values.imageUrl) curation.goodsBands = [{
          id, title, href, imageUrl: values.imageUrl, subcopy: values.subcopy || null, goods: goods.slice(0, 4),
        }];
        break;
      case 'best_tab': {
        const count = Number(values.itemCount);
        const selectedGoods = values.selectionMode === 'latest'
          ? Number.isInteger(count) && count >= 3 && count <= 10 ? latestGoods.slice(0, count) : []
          : goods.slice(0, 12);
        const tab = { id, label: title, goods: selectedGoods };
        if (values.slot === 'popular') curation.popularTabs = [tab];
        else curation.categoryBestTabs = [tab];
        break;
      }
      case 'product_mosaic': {
        const payload = parseHomeMosaicPayload({ mosaic_title: values.mosaicTitle.trim(), mosaic_subtitle: values.mosaicSubtitle.trim(), slots: values.mosaicSlots });
        if (payload) {
          const images = new Map(payload.slots.flatMap((slot, index) => slot.image_path && values.mosaicImageUrls[index] ? [[slot.image_path, values.mosaicImageUrls[index]!] as const] : []));
          curation.mosaicBands = [buildHomeMosaicBand(id, title, payload, publicGoods, path => images.get(path) ?? '')];
        }
        break;
      }
      case 'product_collection': {
        const payload = parseHomeProductCollectionPayload({ layout: values.productLayout, image_shape: values.productImageShape,
          item_count: Number(values.productItemCount), good_ids: values.goodIds });
        if (payload) curation.productCollections = [buildHomeProductCollectionBand(id, title, payload, publicGoods)];
        break;
      }
      case 'benefit':
        curation.benefitTiles = [{ id, title, href, description: values.description || null }];
        break;
      case 'sales_best':
        curation.salesBestBands = [buildHomeSalesBestBand(id, title,
          { exposure: values.salesExposure, period: values.salesPeriod }, publicGoods, productRankings)];
        break;
      case 'review_best': {
        const rule = values.reviewSelectionMode === 'manual'
          ? { mode: 'manual' as const, goodIds: selectedIds } : { mode: 'rating' as const };
        reviewEligibleCount = selectHomeReviewGoods(rule, publicGoods, productRankings).length;
        curation.reviewBestBands = [buildHomeReviewBestBand(id, title, rule, publicGoods, productRankings)];
        break;
      }
      // These retained records are not mounted in the current public Home body.
      // The editor must not present a fictitious public rendering for them.
      case 'announcement':
      case 'featured_ip':
        break;
    }
  }

  return {
    curation,
    noticeStrip,
    missingGoodIds: selectedIds.filter((goodId) => !goodsById.has(goodId)),
    reviewEligibleCount,
  };
}
