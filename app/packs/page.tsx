import type { Metadata } from 'next';
import { CardPacks } from '@/components/screens/CardPacks';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getDrawTicketInventory } from '@/lib/draw-tickets';

export const metadata: Metadata = {
  title: '카드팩 — ICONS',
  description: '굿즈를 구매하면 발급되는 카드팩을 개봉하고, 수집 카드를 바인더에 모아보세요.',
};

export default async function Page() {
  const [catalog, inventory] = await Promise.all([getCatalogSnapshot(), getDrawTicketInventory()]);
  return <CardPacks catalog={catalog} inventory={inventory} />;
}
