import { buildHomeMosaicBand, emptyHomeMosaicSlots, parseHomeMosaicPayload, type HomeMosaicSlot } from '@/lib/home-mosaic';
import { buildHomeProductCollectionBand, isHomeProductImageShape, isHomeProductLayout, parseHomeProductCollectionPayload, type HomeProductImageShape, type HomeProductLayout } from '@/lib/home-product-collection';
import type { AdminCurationKind } from './curations';
import type { AdminCurationRecord } from './curations.server';
import type { HomeCurationSnapshot, HomeGoodsCard, NoticeStrip } from '@/lib/home-catalog';
import { imageBg } from '@/lib/media';
import { homeHeroAltText, homeHeroStyle, normalizeHeroNewlines, type HomeHeroImageDim, type HomeHeroTextColor } from '@/lib/home-hero';
import { buildHomeReviewBestBand, buildHomeSalesBestBand, emptyHomeProductRankings, isHomeSalesPeriod, selectHomeReviewGoods, type HomeProductRankings, type HomeSalesPeriod } from '@/lib/home-ranking';
import { parseShellNoticePageTypes, SHELL_NOTICE_PAGE_TYPES, type ShellNoticeBar, type ShellNoticePageType } from '@/lib/shell-notices';

export const CURATION_KIND_LABELS: Record<AdminCurationKind, string> = {
  hero: '프로모션 배너',
  notice_bar: '텍스트 공지 바',
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
  'notice_bar', 'notice_strip', 'hero', 'editor_pick', 'best_tab', 'sales_best', 'review_best', 'product_collection', 'product_mosaic', 'band_banner', 'benefit', 'featured_ip', 'announcement',
];

export const CURATION_STATUS_LABELS: Record<AdminCurationRecord['status'], string> = {
  active: '노출 중', scheduled: '노출 예정', ended: '종료', inactive: '비노출',
};

/* 셸 공지(텍스트 공지 바·상단 띠배너)의 대상 화면 유형 — 공개 판정은 lib/shell-notices.ts의 shellNoticePageType. */
export const NOTICE_PAGE_TYPE_LABELS: Record<ShellNoticePageType, string> = {
  home: '홈',
  collection: '상품 목록(굿즈샵·NEW·BEST·IP관)',
  product: '상품 상세',
  content: '쇼핑스토리·이벤트',
  other: '그 밖의 화면(검색·장바구니·마이 등)',
};

export const NOTICE_BAR_DEFAULT_CTA = '자세히 보기';

/* 저장된 대상이 있으면 그대로, 대상 없이 저장된 기존 띠배너는 '모든 화면'으로 보여 준다(공개 동작과 같다).
   새 띠배너는 레퍼런스처럼 상품 목록을 빼고 시작한다 — 새 공지 바는 모든 화면에서 시작한다. */
function initialNoticePageTypes(record: AdminCurationRecord | null, kind: AdminCurationKind): ShellNoticePageType[] {
  const saved = parseShellNoticePageTypes(record?.payload?.page_types);
  if (saved) return saved;
  if (!record && kind === 'notice_strip') return SHELL_NOTICE_PAGE_TYPES.filter((type) => type !== 'collection');
  return [...SHELL_NOTICE_PAGE_TYPES];
}

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
  ctaLabel: string;
  pageTypes: ShellNoticePageType[];
}

export interface CurationPublicPreview {
  curation: HomeCurationSnapshot;
  noticeStrip: NoticeStrip | null;
  /** 현재 공개 홈에 보일 텍스트 공지 바(홈 화면 유형 기준 첫 공지). */
  noticeBar?: ShellNoticeBar | null;
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
    /* 새 텍스트 공지 바는 버튼 없이 시작한다 — 이동할 화면을 고르면 버튼이 생긴다. */
    linkPath: record ? record.linkPath ?? '' : initialKind === 'notice_bar' ? '' : '/',
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
    ctaLabel: record ? curationPayloadText(record, 'cta_label') : NOTICE_BAR_DEFAULT_CTA,
    pageTypes: initialNoticePageTypes(record, record?.kind ?? initialKind),
  };
}

/** 종류마다 시작값이 다른 칸 — 새 구성에서 영역(kind)을 바꾸면 운영자가 손대지 않은 칸은 새 종류의 시작값을 따른다. */
export const CURATION_KIND_DEFAULT_FIELDS = ['linkPath', 'pageTypes', 'ctaLabel'] as const satisfies readonly (keyof CurationEditorValues)[];

/**
 * 새 구성(selected 없음)에서 '홈에 보일 영역'을 바꿀 때의 입력값. 기본 새 폼은 프로모션 배너로 시작하므로, 바꾼 종류의
 * 시작값(새 띠배너는 상품 목록 제외, 새 공지 바는 링크 없음·전 화면)을 다시 계산하지 않으면 안내 문구와 실제 체크 상태가
 * 어긋난다. 운영자가 이미 고친 칸(touched)과 저장된 구성의 값은 그대로 둔다.
 */
export function curationValuesForKindChange(
  current: CurationEditorValues,
  nextKind: AdminCurationKind,
  { isNew, touched, draftActiveFrom }: { isNew: boolean; touched: ReadonlySet<keyof CurationEditorValues>; draftActiveFrom: string },
): CurationEditorValues {
  if (!isNew) return current;
  const defaults = createCurationEditorValues(null, draftActiveFrom, nextKind);
  return {
    ...current,
    ...(touched.has('linkPath') ? {} : { linkPath: defaults.linkPath }),
    ...(touched.has('pageTypes') ? {} : { pageTypes: defaults.pageTypes }),
    ...(touched.has('ctaLabel') ? {} : { ctaLabel: defaults.ctaLabel }),
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
): { curation: HomeCurationSnapshot; noticeStrip: NoticeStrip | null; noticeBar: ShellNoticeBar | null; missingGoodIds: string[]; reviewEligibleCount: number } {
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
  let noticeBar: ShellNoticeBar | null = null;
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
      case 'notice_bar': {
        const label = values.ctaLabel.trim();
        /* 미리보기는 모양만 보여 준다 — 노출 기간과 무관하게 그린다. */
        noticeBar = {
          id, key: id, message: title, pageTypes: values.pageTypes,
          cta: href && label ? { label, href } : null, endsAt: null,
        };
        break;
      }
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
    noticeBar,
    missingGoodIds: selectedIds.filter((goodId) => !goodsById.has(goodId)),
    reviewEligibleCount,
  };
}
