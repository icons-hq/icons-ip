import { Binder } from '@/components/screens/Binder';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getBinderCatalogOverlay, getCatalogSource } from '@/lib/catalog';
import {
  STOREFRONT_CARD_PAGE_SIZE,
  getBinderIpProgress,
  getBinderOverview,
  getStorefrontCardsPage,
} from '@/lib/storefront.server';

/*
 * 바인더 (규모 후속).
 *
 * 전에는 카탈로그 전량(IP·굿즈·카드·이벤트)을 읽고 화면이 그 위에서 셌다. 도감이 커지면
 * 1,000행에서 절단 감지가 던져 화면이 통째로 멈춘다.
 *
 * 그래서 **목록과 수치를 다른 문**으로 나눈다: 목록은 서버가 자른 한 페이지, 수치(보유·
 * 달성률·IP 별 진행)는 서버가 전량을 센다. 보유했지만 보관된 카드는 지금까지처럼 덧씌운다 —
 * 공개 도감에서는 빠져도 내 것은 남아 있어야 한다.
 */
function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pageParam(raw: string | string[] | undefined) {
  const parsed = Number.parseInt(firstParam(raw) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const page = pageParam((await searchParams)?.page);
  const source = getCatalogSource();
  const [cardsPage, cardRewardsEnabled, overlay] = await Promise.all([
    getStorefrontCardsPage({ limit: STOREFRONT_CARD_PAGE_SIZE, offset: (page - 1) * STOREFRONT_CARD_PAGE_SIZE }),
    readCardRewardsEnabled(),
    source === 'supabase' ? getBinderCatalogOverlay() : Promise.resolve(null),
  ]);

  const cards = overlay
    ? [...new Map([...cardsPage.cards, ...overlay.cards].map((card) => [card.id, card])).values()]
    : cardsPage.cards;
  const ips = overlay
    ? [...new Map([...cardsPage.ips, ...overlay.ips].map((ip) => [ip.id, ip])).values()]
    : cardsPage.ips;

  const [overview, ipProgress] = await Promise.all([
    getBinderOverview(),
    getBinderIpProgress(ips.map((ip) => ip.id)),
  ]);
  const pageCount = Math.max(1, Math.ceil(cardsPage.total / STOREFRONT_CARD_PAGE_SIZE));

  return (
    <Binder
      cardRewardsEnabled={cardRewardsEnabled}
      catalog={{ source, cards, ips }}
      ipProgress={ipProgress}
      overview={overview}
      ownedCardIds={overlay?.ownedCardIds ?? null}
      paging={{ page: Math.min(page, pageCount), pageCount, basePath: '/binder' }}
    />
  );
}
