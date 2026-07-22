import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { Card, FandomEvent, Good, Ip } from './data';

export const MAX_HOME_PICKER_IPS = 5;

export type HomePostPreviewByIpId = Record<string, CatalogPostPreview | null>;

export interface HomeBanner {
  id: string;
  title: string;
  imageBg: string | null;
  href: string;
}

export interface HomeCurationSnapshot {
  hero: HomeBanner | null;
  announcement: HomeBanner | null;
  featuredIpIds: string[];
}

export function prioritizeHomePostPreviews(
  previewsByIpId: HomePostPreviewByIpId,
  followedIpIds: ReadonlySet<string>,
  orderedIpIds?: readonly string[],
): [string, CatalogPostPreview][] {
  const entries = orderedIpIds === undefined
    ? Object.entries(previewsByIpId).filter(
        (entry): entry is [string, CatalogPostPreview] => entry[1] !== null,
      )
    : orderedIpIds
        .map((ipId) => [ipId, previewsByIpId[ipId]] as const)
        .filter((entry): entry is [string, CatalogPostPreview] => entry[1] != null);

  return [
    ...entries.filter(([ipId]) => followedIpIds.has(ipId)),
    ...entries.filter(([ipId]) => !followedIpIds.has(ipId)),
  ];
}

export interface HomeIpWorld {
  selectableIps: Ip[];
  selectedIp: Ip | null;
  representativeGood: Good | null;
  representativeCard: Card | null;
  representativeEvent: FandomEvent | null;
  representativePost: CatalogPostPreview | null;
}

export function getHomeCuratedIpIds(
  catalog: Pick<CatalogSnapshot, 'ips'>,
  curatedIpIds: readonly string[],
): string[] {
  const catalogIpIds = new Set(catalog.ips.map((ip) => ip.id));
  const seen = new Set<string>();
  const validIds: string[] = [];

  for (const id of curatedIpIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!catalogIpIds.has(id)) continue;
    validIds.push(id);
    if (validIds.length === MAX_HOME_PICKER_IPS) break;
  }

  return validIds;
}

export function getHomeSelectableIps(
  catalog: Pick<CatalogSnapshot, 'ips'>,
  curatedIpIds?: readonly string[],
): Ip[] {
  if (curatedIpIds !== undefined) {
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    const curatedIps = getHomeCuratedIpIds(catalog, curatedIpIds)
      .map((id) => ipsById.get(id))
      .filter((ip): ip is Ip => Boolean(ip));

    return curatedIps.length > 0 ? curatedIps : catalog.ips.slice(0, MAX_HOME_PICKER_IPS);
  }

  const featuredIps = catalog.ips.filter((ip) => ip.featured);
  return (featuredIps.length > 0 ? featuredIps : catalog.ips).slice(0, MAX_HOME_PICKER_IPS);
}

export function buildHomeIpWorld(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'cards' | 'events'>,
  selectedIpId?: string | null,
  postPreviewByIpId: HomePostPreviewByIpId = {},
): HomeIpWorld {
  const selectableIps = getHomeSelectableIps(catalog);
  const selectedIp = selectableIps.find((ip) => ip.id === selectedIpId) ?? selectableIps[0] ?? null;

  if (!selectedIp) {
    return {
      selectableIps,
      selectedIp: null,
      representativeGood: null,
      representativeCard: null,
      representativeEvent: null,
      representativePost: null,
    };
  }

  return {
    selectableIps,
    selectedIp,
    representativeGood: catalog.goods.find((good) => good.ip === selectedIp.id) ?? null,
    representativeCard: catalog.cards.find((card) => card.ip === selectedIp.id) ?? null,
    representativeEvent: catalog.events.find((event) => event.ip === selectedIp.id) ?? null,
    representativePost: postPreviewByIpId[selectedIp.id] ?? null,
  };
}
