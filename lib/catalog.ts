import 'server-only';

import { blockedUserIds } from '@/lib/blocks.server';
import { canViewCommunityPost, formatPostTime, type CommunityPostStatus } from '@/lib/community';
import { DATA, type Card, type FandomEvent, type Good, type Ip, type Stock, type Vertical } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { EMPTY_GOODS_NOTICE } from '@/lib/goods-notice';
import { imageBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from '@/lib/media';
import { isRarityKey } from '@/lib/rarity';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { postgrestInList } from '@/lib/supabase/postgrest';
import { createClient } from '@/lib/supabase/server';
import { resolveCatalogSource, type CatalogSource } from './catalog-source';
import {
  getHomeCuratedIpIds,
  getHomeSelectableIps,
  HOME_BEST_TAB_GOODS_LIMIT,
  HOME_CURATION_IMAGE_PATTERN,
  HOME_GOODS_BAND_LIMIT,
  isSafeInternalLink,
  resolveHomeGoodsCards,
  type HomeBanner,
  type HomeBenefitTile,
  type HomeBestTab,
  type HomeCurationSnapshot,
  type HomeEditorPick,
  type HomeGoodsBand,
  type HomeHeroSlide,
  type HomePostPreviewByIpId,
} from './home-catalog';

export interface CatalogSnapshot {
  source: 'supabase' | 'mock';
  verticals: Vertical[];
  ips: Ip[];
  goods: Good[];
  cards: Card[];
  events: FandomEvent[];
}

export interface CatalogSnapshotOptions {
  previewDefaultSource?: CatalogSource;
}

export function getCatalogSource(options: CatalogSnapshotOptions = {}): CatalogSource {
  return resolveCatalogSource({
    isSupabaseConfigured: getSupabaseConfig().isConfigured,
    previewDefaultSource: options.previewDefaultSource,
  });
}

export interface CatalogPostPreview {
  id: string;
  user: string;
  ipName: string;
  avatar: string;
  text: string;
  likes: number;
  comments: number;
  time: string;
  tag: string;
}

/**
 * 굿즈 상세페이지가 필요로 하는 값 묶음 (#173).
 * 카탈로그 스냅샷의 Good 은 목록용이라 설명·갤러리·고시정보를 담지 않는다.
 */
export interface CatalogGoodDetail extends GoodDetailContent {
  source: CatalogSnapshot['source'];
}

export interface CatalogIpDetail {
  source: CatalogSnapshot['source'];
  ip: Ip;
  goods: Good[];
  cards: Card[];
  events: FandomEvent[];
  posts: CatalogPostPreview[];
}

export interface HomeSnapshot {
  catalog: CatalogSnapshot;
  curation: HomeCurationSnapshot;
  postPreviewByIpId: HomePostPreviewByIpId;
}

export interface CatalogIpDetailOptions {
  viewerId?: string | null;
  isStaff?: boolean;
}

interface VerticalRow {
  key: string;
  label: string;
  color: string;
}

interface IpRow {
  id: string;
  title: string;
  sub: string | null;
  vertical_key: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  image_path: string | null;
  featured: boolean;
  fans_count: number;
  goods_count: number;
  cards_count: number;
}

interface GoodRow {
  id: string;
  ip_id: string;
  name: string;
  type: string;
  price: number;
  /* #326 컬럼 2종은 옵셔널이다 — 기존 테스트 픽스처(리터럴 GoodRow)를 전부
     깨지 않으면서, select 에 포함된 실 쿼리에서는 값이 흐른다. */
  compare_at_price?: number | null;
  created_at?: string | null;
  badge: string | null;
  stock: string;
  stock_qty: number;
  bg: string | null;
  image_path: string | null;
  allow_bank_transfer: boolean | null;
}

interface CardRow {
  id: string;
  ip_id: string;
  name: string;
  no: string | null;
  rarity: string;
  bg: string | null;
  image_path: string | null;
}

interface UserCardOwnershipRow {
  card_id: string;
}

interface EventRow {
  id: string;
  ip_id: string | null;
  title: string;
  mode: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  accent: string | null;
  bg: string | null;
  image_path: string | null;
}

interface PostRow {
  id: string;
  user_id: string;
  ip_id: string | null;
  text: string;
  tag: string | null;
  created_at: string;
  status: CommunityPostStatus;
}

interface HomeCurationRow {
  id: string;
  kind:
    | 'hero'
    | 'featured_ip'
    | 'announcement'
    | 'notice_strip'
    | 'editor_pick'
    | 'band_banner'
    | 'best_tab'
    | 'benefit';
  ip_id: string | null;
  title: string;
  image_path: string | null;
  link_path: string;
  display_order: number;
  active_from: string;
  active_to: string | null;
  slot: string | null;
  payload: Record<string, unknown> | null;
}

interface LoadedFeaturedIpCuration {
  ipId: string;
  imageBg: string | null;
}

/* 굿즈를 참조하는 밴드는 카탈로그 스냅샷과 조인해야 카드가 되므로,
   로더는 id 목록까지만 만들고 getHomeSnapshot 이 최종 조립한다. */
interface LoadedGoodsBand {
  band: Omit<HomeGoodsBand, 'goods'>;
  goodIds: string[];
}

interface LoadedBestTab {
  tab: Omit<HomeBestTab, 'goods'>;
  slot: 'category' | 'popular';
  goodIds: string[];
}

interface LoadedHomeCuration {
  curation: HomeCurationSnapshot;
  featuredIps: LoadedFeaturedIpCuration[];
  goodsBands: LoadedGoodsBand[];
  bestTabs: LoadedBestTab[];
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

const naturalIdCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
type CatalogSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const mockSnapshot = (): CatalogSnapshot => ({
  source: 'mock',
  verticals: Object.values(DATA.V),
  ips: DATA.IPS,
  goods: DATA.GOODS,
  cards: DATA.CARDS,
  events: DATA.EVENTS,
});

const mockPostPreviews = (): CatalogPostPreview[] =>
  DATA.POSTS.map((post) => ({
    id: post.id,
    user: post.user,
    ipName: post.ipName,
    avatar: post.avatar,
    text: post.text,
    likes: post.likes,
    comments: post.comments,
    time: post.time,
    tag: post.tag,
  }));

const fallbackVertical = (key: string): Vertical => ({
  key,
  label: key,
  color: '#8B5CFF',
});

function backgroundFor(
  bg: string | null,
  imagePath: string | null,
  imageUrlForPath: (path: string) => string,
  fallback: string,
) {
  return imagePath ? imageBg(imageUrlForPath(imagePath)) : bg ?? fallback;
}

function byNaturalId<T extends { id: string }>(a: T, b: T) {
  return naturalIdCollator.compare(a.id, b.id);
}

function toStock(stock: string): Stock {
  return stock === 'low' || stock === 'soldout' ? stock : 'ok';
}

function emptyHomeCuration(): HomeCurationSnapshot {
  return {
    hero: null,
    announcement: null,
    featuredIpIds: [],
    heroSlides: [],
    editorPicks: [],
    goodsBands: [],
    categoryBestTabs: [],
    popularTabs: [],
    benefitTiles: [],
  };
}

function emptyLoadedHomeCuration(): LoadedHomeCuration {
  return { curation: emptyHomeCuration(), featuredIps: [], goodsBands: [], bestTabs: [] };
}

/* payload 는 어드민 RPC 가 kind 별 화이트리스트로 검증하지만, 읽기 경로도
   런타임 형태를 다시 확인한다 — DB 를 직접 만진 값이 화면 계약을 깨지 않게. */
function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function payloadGoodIds(payload: Record<string, unknown> | null): string[] {
  const value = payload?.good_ids;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id),
  );
}

function validCurationBase(row: HomeCurationRow): { title: string; href: string } | null {
  const title = row.title.trim();
  const href = row.link_path.trim();
  if (!title || Array.from(title).length > 120 || !isSafeInternalLink(href)) return null;
  if (row.image_path && !HOME_CURATION_IMAGE_PATTERN.test(row.image_path)) return null;
  return { title, href };
}

function toHomeBanner(
  row: HomeCurationRow,
  imageUrlForPath: (path: string) => string,
): HomeBanner | null {
  const base = validCurationBase(row);
  if (!base) return null;
  if (row.kind === 'hero' && (!row.image_path || row.ip_id !== null)) return null;
  if (row.kind === 'announcement' && row.ip_id !== null) return null;
  if (row.kind === 'featured_ip' && !row.ip_id) return null;

  return {
    id: row.id,
    title: base.title,
    imageBg: row.image_path ? imageBg(imageUrlForPath(row.image_path)) : null,
    href: base.href,
  };
}

async function getActiveHomeCurationSnapshot(): Promise<LoadedHomeCuration> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('home_curations')
    .select('id,kind,ip_id,title,image_path,link_path,display_order,active_from,active_to,slot,payload')
    .eq('enabled', true)
    .lte('active_from', now)
    .or(`active_to.is.null,active_to.gt.${now}`)
    .order('kind', { ascending: true })
    .order('display_order', { ascending: true })
    .order('active_from', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(`Failed to load home curations: ${error.message}`);

  const imageUrlForPath = (path: string) => supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
  const curation = emptyHomeCuration();
  const featuredIps: LoadedFeaturedIpCuration[] = [];
  const goodsBands: LoadedGoodsBand[] = [];
  const bestTabs: LoadedBestTab[] = [];

  for (const row of (data ?? []) as HomeCurationRow[]) {
    switch (row.kind) {
      case 'hero': {
        const banner = toHomeBanner(row, imageUrlForPath);
        if (!banner || !row.image_path) break;
        const mobileImagePath = payloadString(row.payload, 'mobile_image_path');
        curation.heroSlides.push({
          id: row.id,
          title: banner.title,
          subtitle: payloadString(row.payload, 'subtitle'),
          imageUrl: imageUrlForPath(row.image_path),
          mobileImageUrl: mobileImagePath && HOME_CURATION_IMAGE_PATTERN.test(mobileImagePath)
            ? imageUrlForPath(mobileImagePath)
            : null,
          href: banner.href,
        } satisfies HomeHeroSlide);
        if (curation.hero === null) curation.hero = banner;
        break;
      }
      case 'announcement': {
        const banner = toHomeBanner(row, imageUrlForPath);
        if (banner && curation.announcement === null) curation.announcement = banner;
        break;
      }
      case 'featured_ip': {
        const banner = toHomeBanner(row, imageUrlForPath);
        if (!banner || typeof row.ip_id !== 'string' || !row.ip_id) break;
        curation.featuredIpIds.push(row.ip_id);
        featuredIps.push({ ipId: row.ip_id, imageBg: banner.imageBg });
        break;
      }
      case 'editor_pick': {
        const base = validCurationBase(row);
        if (!base || !row.image_path || row.ip_id !== null) break;
        curation.editorPicks.push({
          id: row.id,
          title: base.title,
          badge: payloadString(row.payload, 'badge'),
          description: payloadString(row.payload, 'description'),
          imageBg: imageBg(imageUrlForPath(row.image_path)),
          href: base.href,
        } satisfies HomeEditorPick);
        break;
      }
      case 'band_banner': {
        const base = validCurationBase(row);
        if (!base || !row.image_path || row.ip_id !== null) break;
        goodsBands.push({
          band: {
            id: row.id,
            title: base.title,
            subcopy: payloadString(row.payload, 'subcopy'),
            imageUrl: imageUrlForPath(row.image_path),
            href: base.href,
          },
          goodIds: payloadGoodIds(row.payload),
        });
        break;
      }
      case 'best_tab': {
        const base = validCurationBase(row);
        if (!base || row.ip_id !== null) break;
        if (row.slot !== 'category' && row.slot !== 'popular') break;
        bestTabs.push({
          tab: { id: row.id, label: base.title },
          slot: row.slot,
          goodIds: payloadGoodIds(row.payload),
        });
        break;
      }
      case 'benefit': {
        const base = validCurationBase(row);
        if (!base || row.ip_id !== null) break;
        curation.benefitTiles.push({
          id: row.id,
          title: base.title,
          description: payloadString(row.payload, 'description'),
          href: base.href,
        } satisfies HomeBenefitTile);
        break;
      }
      /* notice_strip 은 전역 셸 전용 데이터라 홈 스냅샷에서는 다루지 않는다
         (lib/notice-strip.server.ts). 미래 kind 는 여기 닿기 전에 무시된다. */
      default:
        break;
    }
  }

  return { curation, featuredIps, goodsBands, bestTabs };
}

function applyHomeFeaturedArtwork(
  catalog: CatalogSnapshot,
  featuredIps: readonly LoadedFeaturedIpCuration[],
  selectedIpIds: readonly string[],
): CatalogSnapshot {
  const selectedIdSet = new Set(selectedIpIds);
  const seen = new Set<string>();
  const imageBgByIpId = new Map<string, string>();

  for (const featuredIp of featuredIps) {
    if (!selectedIdSet.has(featuredIp.ipId) || seen.has(featuredIp.ipId)) continue;
    seen.add(featuredIp.ipId);
    if (featuredIp.imageBg) imageBgByIpId.set(featuredIp.ipId, featuredIp.imageBg);
  }

  if (imageBgByIpId.size === 0) return catalog;
  return {
    ...catalog,
    ips: catalog.ips.map((ip) => {
      const imageBg = imageBgByIpId.get(ip.id);
      return imageBg ? { ...ip, bg: imageBg } : ip;
    }),
  };
}

function toIp(row: IpRow, verticalsByKey: Map<string, Vertical>, imageUrlForPath: (path: string) => string): Ip {
  return {
    id: row.id,
    title: row.title,
    sub: row.sub ?? '',
    v: verticalsByKey.get(row.vertical_key) ?? fallbackVertical(row.vertical_key),
    glyph: row.glyph ?? row.title,
    bg: backgroundFor(row.bg, row.image_path, imageUrlForPath, DATA.IPS[0]?.bg ?? ''),
    fans: row.fans_count ?? 0,
    goods: row.goods_count ?? 0,
    cards: row.cards_count ?? 0,
    featured: row.featured,
    tagline: row.tagline ?? '',
    synopsis: row.synopsis ?? '',
  };
}

function toGood(row: GoodRow, imageUrlForPath: (path: string) => string): Good {
  const stockQty = row.stock_qty ?? 0;
  return {
    id: row.id,
    ip: row.ip_id,
    name: row.name,
    type: row.type,
    price: row.price,
    compareAtPrice: row.compare_at_price ?? null,
    badge: row.badge,
    stock: stockQty <= 0 ? 'soldout' : toStock(row.stock),
    stockQty,
    img: backgroundFor(row.bg, row.image_path, imageUrlForPath, DATA.GOODS[0]?.img ?? ''),
    createdAt: row.created_at ?? undefined,
    allowBankTransfer: row.allow_bank_transfer ?? true,
  };
}

function toCard(row: CardRow, imageUrlForPath: (path: string) => string): Card {
  return {
    id: row.id,
    ip: row.ip_id,
    name: row.name,
    no: row.no ?? '',
    rarity: isRarityKey(row.rarity) ? row.rarity : 'N',
    owned: false,
    bg: backgroundFor(row.bg, row.image_path, imageUrlForPath, DATA.CARDS[0]?.bg ?? ''),
  };
}

function eventDateParts(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function formatEventDate(startsAt: string | null, endsAt: string | null) {
  if (!startsAt) return '';

  const start = eventDateParts(startsAt);
  const startDate = `${start.month}.${start.day}`;
  const startTime = start.hour === '00' && start.minute === '00' ? '' : ` ${start.hour}:${start.minute}`;

  if (!endsAt) return `${startDate}${startTime}`;

  const end = eventDateParts(endsAt);
  const endDate = `${end.month}.${end.day}`;
  return startDate === endDate ? `${startDate}${startTime}` : `${startDate} - ${endDate}`;
}

function toEvent(row: EventRow, ipsById: Map<string, Ip>, imageUrlForPath: (path: string) => string): FandomEvent {
  const ip = row.ip_id ? ipsById.get(row.ip_id) : null;
  return {
    id: row.id,
    ip: row.ip_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    date: formatEventDate(row.starts_at, row.ends_at),
    loc: row.location ?? '',
    accent: row.accent ?? ip?.v.color ?? '#8B5CFF',
    img: backgroundFor(row.bg, row.image_path, imageUrlForPath, ip?.bg ?? DATA.EVENTS[0]?.img ?? ''),
  };
}

function toPostPreview(
  row: PostRow,
  ip: Ip,
  profilesById: Map<string, PublicProfileRow>,
  likesByPostId: Map<string, number>,
  commentsByPostId: Map<string, number>,
): CatalogPostPreview {
  const profile = profilesById.get(row.user_id);
  const nickname = profile?.nickname?.trim() || `fan_${row.user_id.slice(0, 6)}`;

  return {
    id: row.id,
    user: nickname,
    ipName: ip.title,
    avatar: ip.v.color,
    text: row.text,
    likes: likesByPostId.get(row.id) ?? 0,
    comments: commentsByPostId.get(row.id) ?? 0,
    time: formatPostTime(row.created_at),
    tag: row.tag?.trim() || '커뮤니티',
  };
}

async function countReactionsByPostId(
  supabase: CatalogSupabaseClient,
  table: 'likes' | 'comments',
  postIds: string[],
  label: 'likes' | 'comments',
  blockedIds: ReadonlySet<string> = new Set(),
) {
  const blockedAuthorIds = Array.from(blockedIds);
  const entries = await Promise.all(
    postIds.map(async (postId) => {
      let query = supabase
        .from(table)
        .select('post_id', { count: 'exact', head: true })
        .eq('post_id', postId);

      if (table === 'comments') {
        query = query.eq('status', 'visible');
        if (blockedAuthorIds.length) {
          query = query.not('user_id', 'in', postgrestInList(blockedAuthorIds));
        }
      }

      const result = await query;

      if (result.error) {
        throw new Error(`Failed to load post ${label}: ${result.error.message}`);
      }

      return [postId, result.count ?? 0] as const;
    }),
  );

  return new Map(entries);
}

export async function getCatalogSnapshot(options: CatalogSnapshotOptions = {}): Promise<CatalogSnapshot> {
  const source = getCatalogSource(options);
  if (source === 'mock') return mockSnapshot();

  const supabase = await createClient();

  const [verticalsResult, ipsResult, goodsResult, cardsResult, eventsResult] = await Promise.all([
    supabase.from('verticals').select('key,label,color').order('key'),
    supabase
      .from('ips')
      .select('id,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count,goods_count,cards_count')
      .is('archived_at', null)
      .order('fans_count', { ascending: false }),
    supabase
      .from('goods')
      .select('id,ip_id,name,type,price,compare_at_price,created_at,badge,stock,stock_qty,bg,image_path,allow_bank_transfer')
      .is('archived_at', null)
      /* 판매 제한(19금) 상품은 성인인증(#209·#210) 도입 전까지 스토어 전 표면에서
         비노출이다(#392). 이 스냅샷이 리스트·검색·홈·바인더를 모두 먹인다. */
      .eq('sale_restriction', 'none')
      .order('id'),
    supabase
      .from('cards')
      .select('id,ip_id,name,no,rarity,bg,image_path')
      .is('archived_at', null)
      .order('id'),
    supabase
      .from('events')
      .select('id,ip_id,title,mode,status,starts_at,ends_at,location,accent,bg,image_path')
      .is('archived_at', null)
      .order('id'),
  ]);

  if (verticalsResult.error) {
    throw new Error(`Failed to load catalog verticals: ${verticalsResult.error.message}`);
  }

  if (ipsResult.error) {
    throw new Error(`Failed to load catalog IPs: ${ipsResult.error.message}`);
  }
  if (goodsResult.error) {
    throw new Error(`Failed to load catalog goods: ${goodsResult.error.message}`);
  }
  if (cardsResult.error) {
    throw new Error(`Failed to load catalog cards: ${cardsResult.error.message}`);
  }
  if (eventsResult.error) {
    throw new Error(`Failed to load catalog events: ${eventsResult.error.message}`);
  }

  const verticals = (verticalsResult.data ?? []) as VerticalRow[];
  const verticalsByKey = new Map(verticals.map((vertical) => [vertical.key, vertical]));
  const imageUrlForPath = (path: string) => {
    const { data } = supabase.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .getPublicUrl(normalizePublicMediaPath(path));
    return data.publicUrl;
  };
  const ips = ((ipsResult.data ?? []) as IpRow[]).map((row) => toIp(row, verticalsByKey, imageUrlForPath));
  const goods = ((goodsResult.data ?? []) as GoodRow[]).map((row) => toGood(row, imageUrlForPath)).sort(byNaturalId);
  const cards = ((cardsResult.data ?? []) as CardRow[]).map((row) => toCard(row, imageUrlForPath)).sort(byNaturalId);
  const ipsById = new Map(ips.map((ip) => [ip.id, ip]));
  const events = ((eventsResult.data ?? []) as EventRow[])
    .map((row) => toEvent(row, ipsById, imageUrlForPath))
    .sort(byNaturalId);

  return {
    source: 'supabase',
    verticals,
    ips,
    goods,
    cards,
    events,
  };
}

export interface BinderCatalogOverlay {
  ownedCardIds: string[];
  cards: Card[];
  ips: Ip[];
}

/**
 * Public discovery excludes archived cards, but an authenticated owner's binder
 * must retain card metadata for historical user_cards rows.
 */
export async function getBinderCatalogOverlay(): Promise<BinderCatalogOverlay | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const ownershipResult = await supabase
    .from('user_cards')
    .select('card_id')
    .gt('qty', 0)
    .order('card_id');

  if (ownershipResult.error) {
    throw new Error(`Failed to load binder ownership: ${ownershipResult.error.message}`);
  }

  const ownedCardIds = [...new Set(
    ((ownershipResult.data ?? []) as UserCardOwnershipRow[]).map((row) => row.card_id),
  )];
  if (!ownedCardIds.length) return { ownedCardIds, cards: [], ips: [] };

  const cardsResult = await supabase
    .from('cards')
    .select('id,ip_id,name,no,rarity,bg,image_path')
    .in('id', ownedCardIds)
    .order('id');

  if (cardsResult.error) {
    throw new Error(`Failed to load binder cards: ${cardsResult.error.message}`);
  }

  const cardRows = (cardsResult.data ?? []) as CardRow[];
  const parentIpIds = [...new Set(cardRows.map((row) => row.ip_id))];
  const [ipsResult, verticalsResult] = await Promise.all([
    supabase
      .from('ips')
      .select('id,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count,goods_count,cards_count')
      .in('id', parentIpIds)
      .order('id'),
    supabase
      .from('verticals')
      .select('key,label,color')
      .order('key'),
  ]);

  if (ipsResult.error) {
    throw new Error(`Failed to load binder IPs: ${ipsResult.error.message}`);
  }
  if (verticalsResult.error) {
    throw new Error(`Failed to load binder verticals: ${verticalsResult.error.message}`);
  }

  const imageUrlForPath = (path: string) => supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
  const verticalsByKey = new Map(
    ((verticalsResult.data ?? []) as VerticalRow[]).map((vertical) => [vertical.key, vertical]),
  );

  return {
    ownedCardIds,
    cards: cardRows.map((row) => toCard(row, imageUrlForPath)).sort(byNaturalId),
    ips: ((ipsResult.data ?? []) as IpRow[])
      .map((row) => toIp(row, verticalsByKey, imageUrlForPath))
      .sort(byNaturalId),
  };
}

export async function getCatalogIp(id: string): Promise<Ip | null> {
  const catalog = await getCatalogSnapshot();
  return catalog.ips.find((ip) => ip.id === id) ?? null;
}

interface GoodDetailRow {
  description: string | null;
  gallery_paths: string[] | null;
  detail_image_path: string | null;
  notice_maker: string | null;
  notice_origin: string | null;
  notice_material: string | null;
  notice_size: string | null;
  notice_made_on: string | null;
  notice_as_manager: string | null;
  notice_as_contact: string | null;
}

/*
 * 굿즈 상세 (#173). 목록 스냅샷에 없는 콘텐츠 컬럼만 따로 읽는다.
 * 보관된 굿즈는 스냅샷에서 이미 빠져 있으므로 여기서도 null 이 되고, 라우트가 404 로 옮긴다.
 */
export async function getCatalogGoodDetail(goodId: string): Promise<CatalogGoodDetail | null> {
  const catalog = await getCatalogSnapshot();
  const good = catalog.goods.find((item) => item.id === goodId);
  if (!good) return null;

  const ip = catalog.ips.find((item) => item.id === good.ip) ?? null;
  const empty: CatalogGoodDetail = {
    source: catalog.source,
    good,
    ip,
    description: null,
    gallery: [],
    detailImageUrl: null,
    notice: EMPTY_GOODS_NOTICE,
  };
  if (catalog.source !== 'supabase') return empty;

  const supabase = await createClient();
  const result = await supabase
    .from('goods')
    /* supabase-js 는 select 를 문자열 리터럴로 받아야 행 타입을 추론한다 — 쪼개면 안 된다. */
    .select('description,gallery_paths,detail_image_path,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact')
    .eq('id', goodId)
    .is('archived_at', null)
    // 스냅샷 제외로 이미 걸러지지만 URL 직접 접근을 이중으로 막는다(#392).
    .eq('sale_restriction', 'none')
    .maybeSingle();

  if (result.error) {
    throw new Error(`Failed to load good detail: ${result.error.message}`);
  }
  if (!result.data) return empty;

  const row = result.data as GoodDetailRow;
  const imageUrlForPath = (path: string) => supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;

  return {
    source: catalog.source,
    good,
    ip,
    description: row.description,
    gallery: (row.gallery_paths ?? []).map((path) => imageBg(imageUrlForPath(path))),
    detailImageUrl: row.detail_image_path ? imageUrlForPath(row.detail_image_path) : null,
    notice: {
      maker: row.notice_maker,
      origin: row.notice_origin,
      material: row.notice_material,
      size: row.notice_size,
      madeOn: row.notice_made_on,
      asManager: row.notice_as_manager,
      asContact: row.notice_as_contact,
    },
  };
}

export function buildCatalogIpDetail(
  catalog: CatalogSnapshot,
  id: string,
  posts: (CatalogPostPreview & { ipId?: string | null })[],
): CatalogIpDetail | null {
  const ip = catalog.ips.find((item) => item.id === id);
  if (!ip) return null;

  return {
    source: catalog.source,
    ip,
    goods: catalog.goods.filter((good) => good.ip === id),
    cards: catalog.cards.filter((card) => card.ip === id),
    events: catalog.events.filter((event) => event.ip === id),
    posts: posts
      .filter((post) => (post.ipId ? post.ipId === id : post.ipName === ip.title))
      .slice(0, 3)
      .map(({ id: postId, user, ipName, avatar, text, likes, comments, time, tag }) => ({
        id: postId,
        user,
        ipName,
        avatar,
        text,
        likes,
        comments,
        time,
        tag,
      })),
  };
}

async function getCatalogPostPreviewsForIp(
  id: string,
  ip: Ip,
  options: CatalogIpDetailOptions = {},
): Promise<CatalogPostPreview[]> {
  const supabase = await createClient();
  const viewerId = options.viewerId ?? null;
  const isStaff = options.isStaff ?? false;
  const blockedIds = await blockedUserIds(supabase, viewerId);
  const blockedAuthorIds = Array.from(blockedIds);
  let postsQuery = supabase
    .from('posts')
    .select('id,user_id,ip_id,text,tag,created_at,status')
    .eq('ip_id', id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!viewerId && !isStaff) {
    postsQuery = postsQuery.eq('status', 'visible');
  }

  if (blockedAuthorIds.length) {
    postsQuery = postsQuery.not('user_id', 'in', postgrestInList(blockedAuthorIds));
  }

  const postsResult = await postsQuery;

  if (postsResult.error) {
    throw new Error(`Failed to load catalog posts: ${postsResult.error.message}`);
  }

  const posts = ((postsResult.data ?? []) as PostRow[]).filter((post) =>
    canViewCommunityPost({ status: post.status, userId: post.user_id }, { viewerId, isStaff }),
  );
  if (!posts.length) return [];

  const postIds = posts.map((post) => post.id);
  const userIds = Array.from(new Set(posts.map((post) => post.user_id)));
  const [profilesResult, likesByPostId, commentsByPostId] = await Promise.all([
    supabase.from('public_profiles').select('id,nickname').in('id', userIds),
    countReactionsByPostId(supabase, 'likes', postIds, 'likes'),
    countReactionsByPostId(supabase, 'comments', postIds, 'comments', blockedIds),
  ]);

  if (profilesResult.error) {
    throw new Error(`Failed to load post authors: ${profilesResult.error.message}`);
  }

  const profilesById = new Map(((profilesResult.data ?? []) as PublicProfileRow[]).map((profile) => [profile.id, profile]));

  return posts.map((post) => toPostPreview(post, ip, profilesById, likesByPostId, commentsByPostId));
}

export async function getCatalogIpDetail(
  id: string,
  options: CatalogIpDetailOptions = {},
): Promise<CatalogIpDetail | null> {
  const catalog = await getCatalogSnapshot();
  const ip = catalog.ips.find((item) => item.id === id);
  if (!ip) return null;

  const posts = catalog.source === 'mock' ? mockPostPreviews() : await getCatalogPostPreviewsForIp(id, ip, options);
  return buildCatalogIpDetail(catalog, id, posts);
}

export async function getHomeSnapshot(options: CatalogIpDetailOptions = {}): Promise<HomeSnapshot> {
  const source = getCatalogSource();
  const [catalog, loadedCuration] = await Promise.all([
    getCatalogSnapshot(),
    source === 'supabase'
      ? getActiveHomeCurationSnapshot()
      : Promise.resolve(emptyLoadedHomeCuration()),
  ]);
  const normalizedCuration: HomeCurationSnapshot = catalog.source === 'mock'
    ? loadedCuration.curation
    : {
        ...loadedCuration.curation,
        featuredIpIds: getHomeCuratedIpIds(catalog, loadedCuration.curation.featuredIpIds),
        goodsBands: loadedCuration.goodsBands.map(({ band, goodIds }) => ({
          ...band,
          goods: resolveHomeGoodsCards(catalog, goodIds, HOME_GOODS_BAND_LIMIT),
        })),
        categoryBestTabs: loadedCuration.bestTabs
          .filter((loaded) => loaded.slot === 'category')
          .map(({ tab, goodIds }) => ({
            ...tab,
            goods: resolveHomeGoodsCards(catalog, goodIds, HOME_BEST_TAB_GOODS_LIMIT),
          })),
        popularTabs: loadedCuration.bestTabs
          .filter((loaded) => loaded.slot === 'popular')
          .map(({ tab, goodIds }) => ({
            ...tab,
            goods: resolveHomeGoodsCards(catalog, goodIds, HOME_BEST_TAB_GOODS_LIMIT),
          })),
      };
  const homeCatalog = catalog.source === 'mock'
    ? catalog
    : applyHomeFeaturedArtwork(catalog, loadedCuration.featuredIps, normalizedCuration.featuredIpIds);
  const selectableIps = getHomeSelectableIps(
    homeCatalog,
    homeCatalog.source === 'mock' ? undefined : normalizedCuration.featuredIpIds,
  );

  if (homeCatalog.source === 'mock') {
    const mockPosts = mockPostPreviews();
    return {
      catalog: homeCatalog,
      curation: normalizedCuration,
      postPreviewByIpId: Object.fromEntries(
        selectableIps.map((ip) => [ip.id, mockPosts.find((post) => post.ipName === ip.title) ?? null]),
      ),
    };
  }

  const postEntries = await Promise.all(
    selectableIps.map(async (ip) => {
      const posts = await getCatalogPostPreviewsForIp(ip.id, ip, options);
      return [ip.id, posts[0] ?? null] as const;
    }),
  );

  return {
    catalog: homeCatalog,
    curation: normalizedCuration,
    postPreviewByIpId: Object.fromEntries(postEntries),
  };
}
