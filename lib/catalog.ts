import 'server-only';

import { canViewCommunityPost, type CommunityPostStatus } from '@/lib/community';
import { DATA, type Card, type FandomEvent, type Good, type Ip, type RarityKey, type Stock, type Vertical } from '@/lib/data';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { resolveCatalogSource, type CatalogSource } from './catalog-source';
import {
  getHomeCuratedIpIds,
  getHomeSelectableIps,
  type HomeBanner,
  type HomeCurationSnapshot,
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
  badge: string | null;
  stock: string;
  stock_qty: number;
  bg: string | null;
  image_path: string | null;
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
  kind: 'hero' | 'featured_ip' | 'announcement';
  ip_id: string | null;
  title: string;
  image_path: string | null;
  link_path: string;
  display_order: number;
  active_from: string;
  active_to: string | null;
}

interface LoadedFeaturedIpCuration {
  ipId: string;
  imageBg: string | null;
}

interface LoadedHomeCuration {
  curation: HomeCurationSnapshot;
  featuredIps: LoadedFeaturedIpCuration[];
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

interface BlockRow {
  blocked_user_id: string;
}

const PUBLIC_MEDIA_BUCKET = 'public-media';
const PUBLIC_MEDIA_PREFIX = `${PUBLIC_MEDIA_BUCKET}/`;
const HOME_CURATION_IMAGE_PATTERN =
  /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const AMBIGUOUS_LINK_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;
const RARITIES: RarityKey[] = ['N', 'R', 'SR', 'SSR', 'HOLO'];
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

const imageBg = (path: string) => `url("${path}") center / cover no-repeat`;

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

function toRarity(rarity: string): RarityKey {
  return RARITIES.includes(rarity as RarityKey) ? (rarity as RarityKey) : 'N';
}

function normalizePublicMediaPath(path: string) {
  const normalizedPath = path.replace(/^\/+/, '');
  return normalizedPath.startsWith(PUBLIC_MEDIA_PREFIX)
    ? normalizedPath.slice(PUBLIC_MEDIA_PREFIX.length)
    : normalizedPath;
}

function blockedUserIdList(blockedIds: ReadonlySet<string>) {
  return Array.from(blockedIds);
}

function postgrestInList(values: readonly string[]) {
  return `(${values.join(',')})`;
}

function emptyHomeCuration(): HomeCurationSnapshot {
  return { hero: null, announcement: null, featuredIpIds: [] };
}

function emptyLoadedHomeCuration(): LoadedHomeCuration {
  return { curation: emptyHomeCuration(), featuredIps: [] };
}

function isSafeInternalLink(value: string) {
  const characterLength = Array.from(value).length;
  if (
    characterLength < 1
    || characterLength > 2048
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(value);
    return (
      decoded.startsWith('/')
      && !decoded.startsWith('//')
      && !decoded.includes('\\')
      && !AMBIGUOUS_LINK_CHARACTER_PATTERN.test(decoded)
    );
  } catch {
    return false;
  }
}

function toHomeBanner(
  row: HomeCurationRow,
  imageUrlForPath: (path: string) => string,
): HomeBanner | null {
  const title = row.title.trim();
  const href = row.link_path.trim();
  if (!title || Array.from(title).length > 120 || !isSafeInternalLink(href)) return null;
  if (row.kind === 'hero' && (!row.image_path || row.ip_id !== null)) return null;
  if (row.kind === 'announcement' && row.ip_id !== null) return null;
  if (row.kind === 'featured_ip' && !row.ip_id) return null;
  if (row.image_path && !HOME_CURATION_IMAGE_PATTERN.test(row.image_path)) return null;

  return {
    id: row.id,
    title,
    imageBg: row.image_path ? imageBg(imageUrlForPath(row.image_path)) : null,
    href,
  };
}

async function getActiveHomeCurationSnapshot(): Promise<LoadedHomeCuration> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('home_curations')
    .select('id,kind,ip_id,title,image_path,link_path,display_order,active_from,active_to')
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

  for (const row of (data ?? []) as HomeCurationRow[]) {
    const banner = toHomeBanner(row, imageUrlForPath);
    if (!banner) continue;

    if (row.kind === 'hero' && curation.hero === null) {
      curation.hero = banner;
    } else if (row.kind === 'announcement' && curation.announcement === null) {
      curation.announcement = banner;
    } else if (row.kind === 'featured_ip' && typeof row.ip_id === 'string' && row.ip_id) {
      curation.featuredIpIds.push(row.ip_id);
      featuredIps.push({ ipId: row.ip_id, imageBg: banner.imageBg });
    }
  }

  return { curation, featuredIps };
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
    badge: row.badge,
    stock: stockQty <= 0 ? 'soldout' : toStock(row.stock),
    stockQty,
    img: backgroundFor(row.bg, row.image_path, imageUrlForPath, DATA.GOODS[0]?.img ?? ''),
  };
}

function toCard(row: CardRow, imageUrlForPath: (path: string) => string): Card {
  return {
    id: row.id,
    ip: row.ip_id,
    name: row.name,
    no: row.no ?? '',
    rarity: toRarity(row.rarity),
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

function formatPostTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
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
  const blockedAuthorIds = blockedUserIdList(blockedIds);
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

async function blockedUserIds(supabase: CatalogSupabaseClient, viewerId: string | null) {
  if (!viewerId) return new Set<string>();

  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_user_id')
    .eq('user_id', viewerId);

  if (error) {
    throw new Error(`Failed to load blocked users: ${error.message}`);
  }

  return new Set(((data ?? []) as BlockRow[]).map((row) => row.blocked_user_id));
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
      .select('id,ip_id,name,type,price,badge,stock,stock_qty,bg,image_path')
      .is('archived_at', null)
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
  const events = ((eventsResult.data ?? []) as EventRow[])
    .map((row) => toEvent(row, new Map(ips.map((ip) => [ip.id, ip])), imageUrlForPath))
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
  const blockedAuthorIds = blockedUserIdList(blockedIds);
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
