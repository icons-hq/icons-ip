/* 전역 셸의 카테고리·온라인 팝업 메가메뉴와 모바일 카테고리 시트 데이터 (LFS 패리티 2차 L5 · CH-05·CH-07·MC-05).
 *
 * 순수 모듈이다 — 서버 로더(`lib/storefront-mega-menu.server.ts`)가 쿠키 없는 캐시 읽기로 모은 값을 검증하고,
 * 셸(Nav·CategorySheet)이 같은 규칙으로 그룹·타일을 만든다.
 * - 카테고리: 공개 전시분류 트리(`get_storefront_category_menu`). 고객 카테고리 공개 스위치가 꺼졌거나 공개 전시가
 *   없으면 비어 있고, 셸은 기존 메뉴(굿즈샵·수집·거래 3그룹·전체 메뉴 시트)로 돌아간다 — 운영 화면이 몰래 바뀌지 않는다.
 * - 기획전: 지금 진행 중인 캠페인(`campaigns`, 정적 배열 금지 — DESIGN §0).
 * - 온라인 팝업: 디렉토리 피처드 IP(`ips.featured`)를 디렉토리와 같은 순서·개수로. */

import { sortIpsForDirectory } from './ip-directory';
import { ipEn } from './ip-display';
import { publicIpHref } from './ip-identity';
import { imageBg } from './media';
import { categoryDisplayHref, hrefFor } from './routes';
import { isUuid } from './uuid';

export const STOREFRONT_MEGA_MENU_CACHE_TAG = 'storefront-mega-menus';
/** 진행 중 기획전은 시트의 2×2 슬라이드 두 장(8개)까지 싣는다. 데스크톱 메가메뉴는 그중 앞 6개를 쓴다. */
export const MENU_CAMPAIGN_LIMIT = 8;
export const MEGA_MENU_CAMPAIGN_LIMIT = 6;
/** 로더가 읽어 오는 진행 중 캠페인 수. 검증에서 빠지는 행이 있어도 다음 순서의 캠페인으로 8개를 채우도록
 *  상한보다 넉넉히 읽고, 자르기는 검증 뒤(`toMenuCampaigns`)에 한다. */
export const MENU_CAMPAIGN_QUERY_LIMIT = MENU_CAMPAIGN_LIMIT * 3;
/** 메뉴 이름 상한(코드 포인트). DB·어드민이 받는 이름 상한과 같다 — 캠페인 제목(campaigns_title_check)·상품분류 이름
 *  (catalog_categories_name_check, 레거시 전시 노드 이름의 출처) 모두 120자다. 이 안의 값은 그대로 싣고 넘치는 표시는 CSS 가
 *  줄인다. DB 상한이 없는 원천(IP 이름·전시 노드 테이블)만 표시용으로 잘라 싣는다 — 길이 때문에 항목이나 트리를 버리지 않는다. */
export const MENU_LABEL_MAX = 120;
/** 온라인 팝업 디렉토리의 피처드 타일 상한(components/screens/IpDirectory.tsx FEATURED_LIMIT)과 같다. */
export const MENU_FEATURED_IP_LIMIT = 5;
/** 데스크톱 온라인 팝업 메가메뉴의 이미지 타일 수(피처드 상위 2, R-01 §4.1 메가메뉴 B·C). */
export const MEGA_MENU_IP_TILE_COUNT = 2;

const NODE_IMAGE = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const CONTROL_RUN = /[\u0000-\u001f\u007f]+/g;

export interface StorefrontCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  depth: number;
  /** 전시분류 아이콘 이미지 공개 URL. 없으면 시트 타일이 이름 첫 글자로 대체한다(LG-7 라인아트 대기). */
  imageUrl: string | null;
  /** 이 노드 자체에 공개 전시(`/shop?displayCategory=`)가 있는가. 없으면 하위 전시를 묶는 제목일 뿐이다. */
  navigable: boolean;
}

export interface StorefrontMenuCampaign {
  id: string;
  title: string;
  imageUrl: string | null;
}

export interface StorefrontMenuIp {
  id: string;
  name: string;
  href: string;
  /** CSS background 값(키아트 이미지 또는 운영 배경). 없으면 이름 첫 글자 타일이다. */
  imageBg: string | null;
}

export interface StorefrontMegaMenus {
  categories: StorefrontCategoryNode[];
  campaigns: StorefrontMenuCampaign[];
  featuredIps: StorefrontMenuIp[];
}

export const EMPTY_STOREFRONT_MEGA_MENUS: StorefrontMegaMenus = { categories: [], campaigns: [], featuredIps: [] };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 메뉴에 싣는 이름. 제어문자(줄바꿈·탭 등 — 캠페인 제목·상품분류 이름은 DB 가 막지 않는다)는 공백 하나로 바꾸고 앞뒤를 다듬는다.
 * 비면 null(그 항목만 뺀다). `MENU_LABEL_MAX` 를 넘는 이름은 버리지 않고 말줄임표로 잘라 싣는다.
 */
export function menuLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.replace(CONTROL_RUN, ' ').trim();
  if (!label) return null;
  const chars = Array.from(label);
  return chars.length <= MENU_LABEL_MAX ? label : `${chars.slice(0, MENU_LABEL_MAX - 1).join('').trimEnd()}…`;
}

/**
 * 공개 메뉴 RPC 응답을 검증한다. 트리 구조(행 모양·id·트리 순서(부모가 먼저)·깊이·부모 참조·이미지 경로)가 하나라도
 * 어긋나면 null — 셸은 기존 메뉴로 돌아간다. 틀린 트리를 그리느니 아는 메뉴를 보여 준다.
 * 이름은 구조가 아니라 행의 표시 값이다: 긴 이름은 잘라 싣고, 쓸 수 있는 이름이 없는 노드만 그 가지째 빼서
 * 나머지 트리는 그대로 그린다(한 행 때문에 메뉴 전체가 조용히 폴백하지 않는다).
 */
export function parseStorefrontCategoryMenu(
  value: unknown,
  publicUrlFor: (path: string) => string,
): StorefrontCategoryNode[] | null {
  if (!Array.isArray(value)) return null;
  const depths = new Map<string, number>();
  const dropped = new Set<string>();
  const nodes: StorefrontCategoryNode[] = [];
  for (const row of value) {
    if (!record(row) || !isUuid(row.id) || depths.has(row.id) || typeof row.navigable !== 'boolean' || typeof row.name !== 'string') return null;
    const depth = row.depth;
    if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 4) return null;
    if (row.parentId === null ? depth !== 1 : !isUuid(row.parentId) || depths.get(row.parentId) !== Number(depth) - 1) return null;
    if (row.imagePath !== null && (typeof row.imagePath !== 'string' || !NODE_IMAGE.test(row.imagePath))) return null;
    depths.set(row.id, Number(depth));
    const name = menuLabel(row.name);
    if (!name || (row.parentId !== null && dropped.has(row.parentId as string))) {
      dropped.add(row.id);
      continue;
    }
    nodes.push({
      id: row.id,
      parentId: row.parentId as string | null,
      name,
      depth: Number(depth),
      imageUrl: row.imagePath === null ? null : publicUrlFor(row.imagePath),
      navigable: row.navigable,
    });
  }
  /* 공개 전시가 없는 가지는 SQL 이 이미 뺀다 — 이름 없는 가지를 뺀 뒤에도 같은 규칙(목적지 또는 목적지 있는 후손)을 지킨다. */
  const leadsSomewhere = new Set<string>();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!node.navigable && !leadsSomewhere.has(node.id)) continue;
    leadsSomewhere.add(node.id);
    if (node.parentId) leadsSomewhere.add(node.parentId);
  }
  const visible = nodes.filter((node) => leadsSomewhere.has(node.id));
  /* 목적지 없는 제목만 남은 응답은 그리지 않는다(빈 응답 = 꺼진 메뉴). */
  return visible.length ? visible : value.length ? null : [];
}

/** 진행 중 캠페인 행(RLS 공개 읽기 — 초안 제외)을 메뉴 항목으로. 로더가 진행 중·순서로 좁혀 상한보다 넉넉히 읽어 오고,
 *  여기서 검증한 뒤 `MENU_CAMPAIGN_LIMIT` 로 자른다 — 빠지는 행이 있어도 다음 순서의 캠페인이 자리를 채운다. */
export function toMenuCampaigns(rows: unknown, publicUrlFor: (path: string) => string): StorefrontMenuCampaign[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const campaigns: StorefrontMenuCampaign[] = [];
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue;
    const title = menuLabel(row.title);
    if (!title) continue;
    seen.add(row.id);
    campaigns.push({
      id: row.id,
      title,
      imageUrl: typeof row.card_image_path === 'string' && row.card_image_path ? publicUrlFor(row.card_image_path) : null,
    });
    if (campaigns.length >= MENU_CAMPAIGN_LIMIT) break;
  }
  return campaigns;
}

/** 피처드 IP 행을 디렉토리와 같은 순서(운영 순번 → 영문 표시명)·상한으로 메뉴 항목으로.
 *  IP 이름은 DB 상한이 없다 — 정렬은 디렉토리처럼 원래 이름으로 하고, 표시 이름만 `menuLabel` 로 다듬어 자른다. */
export function toMenuIps(rows: unknown, publicUrlFor: (path: string) => string): StorefrontMenuIp[] {
  if (!Array.isArray(rows)) return [];
  const ips = rows.flatMap((row) => {
    if (!record(row) || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string') return [];
    const name = menuLabel(ipEn({ id: row.id, title: row.title }));
    if (!name) return [];
    return [{
      id: row.id,
      title: row.title,
      name,
      publicSlug: typeof row.public_slug === 'string' && row.public_slug ? row.public_slug : null,
      sortOrder: Number.isInteger(row.sort_order) ? Number(row.sort_order) : undefined,
      imagePath: typeof row.image_path === 'string' && row.image_path ? row.image_path : null,
      bg: typeof row.bg === 'string' && row.bg.trim() ? row.bg.trim() : null,
    }];
  });
  return sortIpsForDirectory(ips).slice(0, MENU_FEATURED_IP_LIMIT).map((ip) => ({
    id: ip.id,
    name: ip.name,
    href: publicIpHref({ id: ip.id, publicSlug: ip.publicSlug }),
    imageBg: ip.imagePath ? imageBg(publicUrlFor(ip.imagePath)) : ip.bg,
  }));
}

/** 카테고리 메뉴가 켜졌는가(공개 스위치 ON + 공개 전시 1개 이상). 아니면 셸은 기존 메뉴로 돌아간다. */
export function isCategoryMenuLive(menus: Pick<StorefrontMegaMenus, 'categories'>): boolean {
  return menus.categories.some((node) => node.navigable);
}

export interface CategoryMenuEntry {
  id: string;
  name: string;
  depth: number;
  /** 공개 전시 주소. null 이면 하위 전시를 묶는 이름표다. */
  href: string | null;
}

export interface CategoryMenuGroup extends CategoryMenuEntry {
  items: CategoryMenuEntry[];
}

function entryOf(node: StorefrontCategoryNode): CategoryMenuEntry {
  return { id: node.id, name: node.name, depth: node.depth, href: node.navigable ? categoryDisplayHref(node.id) : null };
}

/** 데스크톱 메가메뉴 그룹 — 최상위 전시분류가 그룹 제목, 그 아래 전시가 트리 순서의 링크다. */
export function categoryMenuGroups(nodes: readonly StorefrontCategoryNode[]): CategoryMenuGroup[] {
  const groups: CategoryMenuGroup[] = [];
  for (const node of nodes) {
    if (node.depth === 1) groups.push({ ...entryOf(node), items: [] });
    else groups[groups.length - 1]?.items.push(entryOf(node));
  }
  return groups;
}

export interface CategoryMenuTile {
  id: string;
  name: string;
  href: string;
  imageUrl: string | null;
}

/** 모바일 카테고리 시트의 아이콘 그리드 — 목적지가 있는 전시분류만, 트리 순서로. */
export function categoryMenuTiles(nodes: readonly StorefrontCategoryNode[]): CategoryMenuTile[] {
  return nodes.filter((node) => node.navigable).map((node) => ({
    id: node.id, name: node.name, href: categoryDisplayHref(node.id), imageUrl: node.imageUrl,
  }));
}

/** 이미지가 없을 때 타일 안에 놓는 첫 글자(조합 문자 한 덩어리). */
export function menuMonogram(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

/** 2×2 슬라이드 묶음. */
export function chunkMenuItems<T>(items: readonly T[], size = 4): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages;
}

export interface MegaMenuLocation {
  /** 굿즈샵 바로가기(NEW·BEST·전체 굿즈)의 현재 위치를 가릴 때 쓰는 경로. null 이면 바로가기 중 어느 것도 켜지 않는다. */
  routePathname: string | null;
  /** 현재 위치로 표시할 전시분류 노드 id(소문자 UUID). 카테고리 전시 페이지가 아니면 null. */
  displayCategoryId: string | null;
}

/**
 * 메가메뉴의 현재 위치(리뷰 l5-ui-2). 카테고리 전시(`/shop?displayCategory=<UUID>`)는 경로가 '전체 굿즈'(`/shop`)와 같아
 * 쿼리로만 가려진다 — 전시 페이지에서는 그 전시분류 링크가 현재 위치이고 '전체 굿즈'는 아니다.
 * `query` 가 null 이면 쿼리를 아직 모르는 상태(정적 HTML 의 Suspense 폴백)다. 그때 `/shop` 에서는 틀리게 켜느니 바로가기를 켜지 않는다.
 */
export function megaMenuLocation(pathname: string, query: { get(name: string): string | null; has(name: string): boolean } | null): MegaMenuLocation {
  if (pathname !== hrefFor('shop')) return { routePathname: pathname, displayCategoryId: null };
  if (!query) return { routePathname: null, displayCategoryId: null };
  if (!query.has('displayCategory')) return { routePathname: pathname, displayCategoryId: null };
  const value = query.get('displayCategory');
  return { routePathname: null, displayCategoryId: isUuid(value) ? value.toLowerCase() : null };
}
