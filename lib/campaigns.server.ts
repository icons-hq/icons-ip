import 'server-only';

import { cache } from 'react';
import {
  campaignDisplayState,
  isCampaignKind,
  isCampaignStatus,
  orderCampaignsForHub,
  parseCampaignSections,
  type CampaignDetailData,
  type CampaignSection,
  type CampaignSummary,
} from '@/lib/campaigns';
import { imageBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from '@/lib/media';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 캠페인 허브·상세 로더 (S8 #330).
 *
 * 읽기는 RLS select 로 한다 — campaigns_public_read 가 draft 를 비운영자에게서
 * 가리고, coin_exchange_offers_public_read 가 내린 교환 상품을 감춘다. 이 파일은
 * 그 위에 아무 권한 판정도 얹지 않는다.
 *
 * 절대 던지지 않는다. 이벤트 허브는 공개 브라우징 표면이라, 못 읽었다고 500 이 되면
 * 로그인도 하지 않은 방문자에게 사이트가 고장 난 것으로 보인다 — 빈 허브·null 상세로
 * 접고 화면이 빈 상태를 그린다(DESIGN §9). */

interface CampaignRow {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  card_image_path: string | null;
  banner_image_path: string | null;
  featured_order: number | null;
}

interface CampaignDetailRow extends CampaignRow {
  hero_image_path: string | null;
  sections: unknown;
}

interface ExchangeOfferRow {
  id: string;
  label: string;
  coin_cost: number;
  ticket_count: number;
}

interface GoodRow {
  id: string;
  name: string;
  price: number;
  compare_at_price: number | null;
  badge: string | null;
  stock: string;
  stock_qty: number;
  bg: string | null;
  image_path: string | null;
}

const HUB_COLUMNS =
  'id,kind,title,subtitle,status,starts_at,ends_at,card_image_path,banner_image_path,featured_order';
const DETAIL_COLUMNS = `${HUB_COLUMNS},hero_image_path,sections`;

export interface CampaignHubSnapshot {
  /** featured_order 오름차순. 상단 배너 슬라이더가 이 순서로 그린다. */
  banners: CampaignSummary[];
  campaigns: CampaignSummary[];
}

export interface ExchangeOfferView {
  id: string;
  label: string;
  coinCost: number;
  ticketCount: number;
}

export interface GoodCardView {
  id: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  badge: string | null;
  soldOut: boolean;
  imageBackground: string;
}

/* 참조를 해석한 본문. exchange 는 offer 를, goods 는 상품 카드를 함께 들고 온다.
   화면이 로더를 한 번 더 부르지 않게 하는 것이 목적이다 — 블록마다 클라이언트에서
   조회하면 상세 한 장에 요청이 블록 수만큼 늘어난다. */
export type ResolvedCampaignSection =
  | Exclude<CampaignSection, { type: 'exchange' } | { type: 'goods' }>
  | (Extract<CampaignSection, { type: 'exchange' }> & { offer: ExchangeOfferView | null })
  | (Extract<CampaignSection, { type: 'goods' }> & { goods: GoodCardView[] });

export interface CampaignLandingSnapshot extends CampaignDetailData {
  resolvedSections: ResolvedCampaignSection[];
}

const EMPTY_HUB: CampaignHubSnapshot = { banners: [], campaigns: [] };

type CampaignSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function publicUrlResolver(supabase: CampaignSupabaseClient) {
  return (path: string | null) => (
    path
      ? supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl
      : null
  );
}

function toSummary(
  row: CampaignRow,
  toPublicUrl: (path: string | null) => string | null,
  now: number,
): CampaignSummary | null {
  /* kind 를 모르면 어느 탭에도 넣을 수 없고 뱃지 텍스트도 정할 수 없다 — 조용히 뺀다. */
  if (!isCampaignKind(row.kind)) return null;

  /* status 도 접지 않고 그대로 싣는다. draft 를 published 로 접으면 RLS 가 draft 를
     보여 주는 유일한 상대 — 운영자 — 에게 준비 중 캠페인이 '진행중'으로 보인다.
     모르는 값은 kind 와 같은 관대 원칙으로 행째 건너뛴다. */
  if (!isCampaignStatus(row.status)) return null;

  const status = row.status;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    cardImagePath: toPublicUrl(row.card_image_path),
    bannerImagePath: toPublicUrl(row.banner_image_path),
    featuredOrder: row.featured_order,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status,
    displayState: campaignDisplayState(
      { status, startsAt: row.starts_at, endsAt: row.ends_at },
      now,
    ),
  };
}

/** 이벤트 허브 — 배너 슬라이더 + ALL/EVENT/DROP 탭이 읽는 한 벌. */
export async function loadCampaignHub(): Promise<CampaignHubSnapshot> {
  if (!getSupabaseConfig().isConfigured) return EMPTY_HUB;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(HUB_COLUMNS)
    .order('starts_at', { ascending: false });

  if (error) return EMPTY_HUB;

  const now = Date.now();
  const toPublicUrl = publicUrlResolver(supabase);
  const summaries = ((data ?? []) as CampaignRow[]).flatMap((row) => {
    const summary = toSummary(row, toPublicUrl, now);
    return summary ? [summary] : [];
  });

  /* 배너는 운영자가 featured_order 를 직접 매긴 편성이다. 종료된 캠페인이라도 빼지
     않는다 — 뺄지 말지는 그 순서를 매긴 운영자의 결정이고, 대신 배너에도 상태 뱃지를
     실어 "끝난 이벤트"가 그대로 보이게 한다. */
  const banners = summaries
    .filter((summary) => summary.featuredOrder !== null)
    .sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0));

  return { banners, campaigns: orderCampaignsForHub(summaries) };
}

async function loadExchangeOffers(
  supabase: CampaignSupabaseClient,
  offerIds: string[],
): Promise<Map<string, ExchangeOfferView>> {
  if (!offerIds.length) return new Map();

  const { data, error } = await supabase
    .from('coin_exchange_offers')
    .select('id,label,coin_cost,ticket_count')
    .in('id', offerIds);

  if (error) return new Map();

  return new Map(((data ?? []) as ExchangeOfferRow[]).map((row) => [row.id, {
    id: row.id,
    label: row.label,
    coinCost: row.coin_cost,
    ticketCount: row.ticket_count,
  }]));
}

async function loadSectionGoods(
  supabase: CampaignSupabaseClient,
  goodIds: string[],
): Promise<Map<string, GoodCardView>> {
  if (!goodIds.length) return new Map();

  const { data, error } = await supabase
    .from('goods')
    .select('id,name,price,compare_at_price,badge,stock,stock_qty,bg,image_path')
    .in('id', goodIds);

  if (error) return new Map();

  const toPublicUrl = publicUrlResolver(supabase);
  return new Map(((data ?? []) as GoodRow[]).map((row) => {
    const imageUrl = toPublicUrl(row.image_path);
    const stockQty = row.stock_qty ?? 0;
    return [row.id, {
      id: row.id,
      name: row.name,
      price: row.price,
      compareAtPrice: row.compare_at_price ?? null,
      badge: row.badge,
      soldOut: stockQty <= 0 || row.stock === 'soldout',
      imageBackground: imageUrl ? imageBg(imageUrl) : row.bg ?? '',
    }];
  }));
}

async function resolveCampaignDetail(id: string): Promise<CampaignLandingSnapshot | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle<CampaignDetailRow>();

  if (error || !data) return null;

  const now = Date.now();
  const toPublicUrl = publicUrlResolver(supabase);
  const summary = toSummary(data, toPublicUrl, now);
  if (!summary) return null;

  const sections = parseCampaignSections(data.sections);
  const offerIds = sections.flatMap((section) => (section.type === 'exchange' ? [section.offer_id] : []));
  const goodIds = sections.flatMap((section) => (section.type === 'goods' ? section.good_ids : []));

  const [offers, goods] = await Promise.all([
    loadExchangeOffers(supabase, [...new Set(offerIds)]),
    loadSectionGoods(supabase, [...new Set(goodIds)]),
  ]);

  const resolvedSections: ResolvedCampaignSection[] = sections.map((section) => {
    /* 상품을 못 찾았다고 블록을 지우지 않는다. 블록이 통째로 사라지면 앵커 내브의
       목차 항목도 같이 사라져 페이지가 "원래 그런 구성"처럼 보인다 — 자리는 남기고
       화면이 "지금은 교환할 수 없어요"를 그리게 offer: null 로 표시한다. */
    if (section.type === 'exchange') {
      return { ...section, offer: offers.get(section.offer_id) ?? null };
    }
    /* 굿즈는 반대다. 개별 id 가 사라진 것은 그 상품이 내려간 것이고, 남은 상품으로
       블록이 여전히 성립한다 — 결측 id 만 뺀다. */
    if (section.type === 'goods') {
      return {
        ...section,
        goods: section.good_ids.flatMap((goodId) => {
          const good = goods.get(goodId);
          return good ? [good] : [];
        }),
      };
    }
    return section;
  });

  return {
    ...summary,
    heroImagePath: toPublicUrl(data.hero_image_path),
    sections,
    resolvedSections,
  };
}

/**
 * 캠페인 상세 한 벌.
 *
 * generateMetadata 와 Page 가 같은 요청에서 두 번 부른다 — cache() 로 감싸지 않으면
 * 상세 한 장에 캠페인·교환 상품·굿즈 조회가 각각 두 벌씩 나간다.
 */
export const loadCampaignDetail = cache(resolveCampaignDetail);
