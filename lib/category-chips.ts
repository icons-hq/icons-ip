import { categoryDisplayHref } from './routes';
import type { StorefrontCategoryNode } from './storefront-mega-menu';

/* 카테고리 화면의 칩 영역·제목·하위 탭 모델 (스펙 C §2.4, D6~D8).
 *
 * 순수 함수 하나다 — 공개 전시 트리(`getStorefrontMegaMenus().categories`, 트리 순서 = 부모가 먼저)와 지금 보는 전시 노드 id 에서
 * 칩 1·2줄, 제목, 하위 탭, 선택 판정을 모두 끝낸다. 화면(CategoryChips·ListingHeader)은 결과만 그린다.
 * 칩과 탭이 노드로 가는 링크는 노드가 `navigable` 이면 자기 전시, 아니면 트리 순서상 첫 navigable 자손이다 — 어디로도 못 가는 노드는 그리지 않는다. */

/** 칩 1줄에 '전체' 칩과 함께 놓는 1단계 노드 수. 나머지는 구분선 아래 2줄이다(해석 D7 — 운영자가 트리 순서로 줄을 정한다). */
export const CATEGORY_CHIP_FIRST_ROW_COUNT = 4;
export const CATEGORY_ALL_CHIP_LABEL = '전체';
export const CATEGORY_ALL_TITLE = '전체 굿즈';
export const CATEGORY_ALL_HREF = '/shop';

export interface CategoryChip {
  id: string;
  label: string;
  href: string;
  selected: boolean;
}

export interface CategoryTab {
  id: string;
  label: string;
  href: string;
  selected: boolean;
}

export interface CategoryListingNav {
  /** 칩 1줄('전체' + 1단계 앞 4개)과 2줄(나머지). 공개 트리가 비면 둘 다 빈 배열이다. */
  firstRow: CategoryChip[];
  secondRow: CategoryChip[];
  /** 제목 — 선택한 1단계 노드 이름, 전체 목록이면 '전체 굿즈'. 트리에서 현재 노드를 못 찾으면 null(호출부가 자기 제목을 쓴다). */
  title: string | null;
  /** 현재 노드가 3단계 이하일 때 제목 아래 작은 줄에 보이는 그 노드 이름. */
  subtitle: string | null;
  /** 선택한 1단계의 하위 탭('전체' + 2단계 자식). 자식이 없거나 갈 곳이 없으면 빈 배열이다. */
  tabs: CategoryTab[];
}

export const EMPTY_CATEGORY_LISTING_NAV: CategoryListingNav = { firstRow: [], secondRow: [], title: null, subtitle: null, tabs: [] };

/** 노드로 가는 링크 — 자기 전시가 있으면 그것, 없으면 트리 순서상 첫 navigable 자손. 어디로도 못 가면 null. */
function linkTargetOf(nodes: readonly StorefrontCategoryNode[], node: StorefrontCategoryNode): string | null {
  if (node.navigable) return categoryDisplayHref(node.id);
  const start = nodes.findIndex((candidate) => candidate.id === node.id);
  if (start < 0) return null;
  const family = new Set([node.id]);
  for (let index = start + 1; index < nodes.length; index += 1) {
    const candidate = nodes[index];
    if (!candidate.parentId || !family.has(candidate.parentId)) continue;
    family.add(candidate.id);
    if (candidate.navigable) return categoryDisplayHref(candidate.id);
  }
  return null;
}

/** 노드에서 1단계 조상까지의 경로(루트 먼저). 부모 참조가 끊기면 거기까지만 돌려준다. */
function pathTo(nodes: readonly StorefrontCategoryNode[], currentId: string): StorefrontCategoryNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: StorefrontCategoryNode[] = [];
  const seen = new Set<string>();
  let node = byId.get(currentId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return path;
}

/**
 * 지금 보는 위치(`currentId` — 전시 노드 id, `/shop` 전체 목록이면 null)에서 카테고리 화면 모델을 만든다.
 * `nodes` 는 공개 전시 트리를 트리 순서로 준 것이다(부모가 자식보다 먼저). 비어 있으면(고객 카테고리 스위치 OFF·전시 없음)
 * 칩·탭 없이 전체 목록 제목만 남는다.
 */
export function buildCategoryListingNav(nodes: readonly StorefrontCategoryNode[], currentId: string | null): CategoryListingNav {
  if (nodes.length === 0) return { ...EMPTY_CATEGORY_LISTING_NAV, title: currentId === null ? CATEGORY_ALL_TITLE : null };

  const path = currentId === null ? [] : pathTo(nodes, currentId);
  const current = path.length > 0 && path[path.length - 1].id === currentId ? path[path.length - 1] : null;
  /* 현재 노드가 공개 트리에 없으면(막 비공개로 바뀐 전시 등) 칩은 그리되 아무것도 선택하지 않는다. */
  const root = path[0] ?? null;

  const chips: CategoryChip[] = [];
  for (const node of nodes) {
    if (node.parentId !== null) continue;
    const href = linkTargetOf(nodes, node);
    if (href) chips.push({ id: node.id, label: node.name, href, selected: node.id === root?.id });
  }
  const allChip: CategoryChip = { id: 'all', label: CATEGORY_ALL_CHIP_LABEL, href: CATEGORY_ALL_HREF, selected: currentId === null };

  const tabs: CategoryTab[] = [];
  if (root) {
    const children = nodes.filter((node) => node.parentId === root.id);
    const childTabs: CategoryTab[] = [];
    for (const child of children) {
      const href = linkTargetOf(nodes, child);
      if (href) childTabs.push({ id: child.id, label: child.name, href, selected: path[1]?.id === child.id });
    }
    if (childTabs.length > 0) {
      /* '전체' 탭은 1단계 자체다 — 이게 없으면 부모에 직접 걸린 굿즈와 다른 자식의 굿즈가 목록에서 숨는다(D8). 1단계 자체에 전시가 있을 때만 그린다. */
      if (root.navigable) tabs.push({ id: root.id, label: CATEGORY_ALL_CHIP_LABEL, href: categoryDisplayHref(root.id), selected: path.length === 1 });
      tabs.push(...childTabs);
    }
  }

  return {
    firstRow: [allChip, ...chips.slice(0, CATEGORY_CHIP_FIRST_ROW_COUNT)],
    secondRow: chips.slice(CATEGORY_CHIP_FIRST_ROW_COUNT),
    title: currentId === null ? CATEGORY_ALL_TITLE : root?.name ?? null,
    subtitle: current && current.depth >= 3 ? current.name : null,
    tabs,
  };
}
