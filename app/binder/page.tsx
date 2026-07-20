import { Binder } from '@/components/screens/Binder';
import { getBinderCatalogOverlay, getCatalogSnapshot } from '@/lib/catalog';

export default async function Page() {
  const catalog = await getCatalogSnapshot();
  const overlay = catalog.source === 'supabase' ? await getBinderCatalogOverlay() : null;
  const cards = overlay
    ? [...new Map([...catalog.cards, ...overlay.cards].map((card) => [card.id, card])).values()]
    : catalog.cards;
  const ips = overlay
    ? [...new Map([...catalog.ips, ...overlay.ips].map((ip) => [ip.id, ip])).values()]
    : catalog.ips;

  return (
    <Binder
      catalog={{ ...catalog, cards, ips }}
      ownedCardIds={overlay?.ownedCardIds ?? null}
    />
  );
}
