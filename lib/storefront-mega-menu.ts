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
import { categoryDisplayHref } from './routes';
import { isUuid } from './uuid';

export const STOREFRONT_MEGA_MENU_CACHE_TAG = 'storefront-mega-menus';
/** 진행 중 기획전은 시트의 2×2 슬라이드 두 장(8개)까지 싣는다. 데스크톱 메가메뉴는 그중 앞 6개를 쓴다. */
export const MENU_CAMPAIGN_LIMIT = 8;
export const MEGA_MENU_CAMPAIGN_LIMIT = 6;
/** 온라인 팝업 디렉토리의 피처드 타일 상한(components/screens/IpDirectory.tsx FEATURED_LIMIT)과 같다. */
export const MENU_FEATURED_IP_LIMIT = 5;
/** 데스크톱 온라인 팝업 메가메뉴의 이미지 타일 수(피처드 상위 2, R-01 §4.1 메가메뉴 B·C). */
export const MEGA_MENU_IP_TILE_COUNT = 2;

const NODE_IMAGE = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

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

function menuName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && [...name].length <= 100 && !CONTROL.test(name) ? name : null;
}

/**
 * 공개 메뉴 RPC 응답을 검증한다. 트리 순서(부모가 먼저)·깊이·부모 참조가 하나라도 어긋나면 null —
 * 셸은 기존 메뉴로 돌아간다. 틀린 트리를 그리느니 아는 메뉴를 보여 준다.
 */
export function parseStorefrontCategoryMenu(
  value: unknown,
  publicUrlFor: (path: string) => string,
): StorefrontCategoryNode[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Map<string, StorefrontCategoryNode>();
  const nodes: StorefrontCategoryNode[] = [];
  for (const row of value) {
    if (!record(row) || !isUuid(row.id) || seen.has(row.id) || typeof row.navigable !== 'boolean') return null;
    const name = menuName(row.name);
    const depth = row.depth;
    if (!name || !Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 4) return null;
    if (row.parentId === null ? depth !== 1 : !isUuid(row.parentId) || seen.get(row.parentId)?.depth !== Number(depth) - 1) return null;
    if (row.imagePath !== null && (typeof row.imagePath !== 'string' || !NODE_IMAGE.test(row.imagePath))) return null;
    const node: StorefrontCategoryNode = {
      id: row.id,
      parentId: row.parentId as string | null,
      name,
      depth: Number(depth),
      imageUrl: row.imagePath === null ? null : publicUrlFor(row.imagePath),
      navigable: row.navigable,
    };
    seen.set(node.id, node);
    nodes.push(node);
  }
  /* 공개 전시가 없는 가지는 SQL 이 이미 뺀다 — 그래도 목적지 없는 제목만 남은 응답은 그리지 않는다. */
  return nodes.some((node) => node.navigable) ? nodes : nodes.length ? null : [];
}

/** 진행 중 캠페인 행(RLS 공개 읽기 — 초안 제외)을 메뉴 항목으로. 로더가 진행 중·순서·상한으로 이미 좁혀 온다. */
export function toMenuCampaigns(rows: unknown, publicUrlFor: (path: string) => string): StorefrontMenuCampaign[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const campaigns: StorefrontMenuCampaign[] = [];
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue;
    const title = menuName(row.title);
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

/** 피처드 IP 행을 디렉토리와 같은 순서(운영 순번 → 영문 표시명)·상한으로 메뉴 항목으로. */
export function toMenuIps(rows: unknown, publicUrlFor: (path: string) => string): StorefrontMenuIp[] {
  if (!Array.isArray(rows)) return [];
  const ips = rows.flatMap((row) => {
    if (!record(row) || typeof row.id !== 'string' || !row.id) return [];
    const title = menuName(row.title);
    if (!title) return [];
    return [{
      id: row.id,
      title,
      publicSlug: typeof row.public_slug === 'string' && row.public_slug ? row.public_slug : null,
      sortOrder: Number.isInteger(row.sort_order) ? Number(row.sort_order) : undefined,
      imagePath: typeof row.image_path === 'string' && row.image_path ? row.image_path : null,
      bg: typeof row.bg === 'string' && row.bg.trim() ? row.bg.trim() : null,
    }];
  });
  return sortIpsForDirectory(ips).slice(0, MENU_FEATURED_IP_LIMIT).map((ip) => ({
    id: ip.id,
    name: ipEn(ip),
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
