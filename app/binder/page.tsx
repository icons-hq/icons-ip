import { Binder } from '@/components/screens/Binder';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getOwnedCardIds } from '@/lib/draw-tickets';

export default async function Page() {
  const catalog = await getCatalogSnapshot();
  const ownedCardIds = catalog.source === 'supabase' ? await getOwnedCardIds() : null;
  return <Binder catalog={catalog} ownedCardIds={ownedCardIds} />;
}
