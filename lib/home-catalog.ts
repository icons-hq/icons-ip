import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { Card, FandomEvent, Good, Ip } from './data';

export const MAX_HOME_PICKER_IPS = 5;

export type HomePostPreviewByIpId = Record<string, CatalogPostPreview | null>;

export function prioritizeHomePostPreviews(
  previewsByIpId: HomePostPreviewByIpId,
  followedIpIds: ReadonlySet<string>,
): [string, CatalogPostPreview][] {
  const entries = Object.entries(previewsByIpId).filter(
    (entry): entry is [string, CatalogPostPreview] => entry[1] !== null,
  );

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

export function getHomeSelectableIps(catalog: Pick<CatalogSnapshot, 'ips'>): Ip[] {
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
