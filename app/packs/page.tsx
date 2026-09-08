import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { CardPacks } from '@/components/screens/CardPacks';
import { getCatalogSource } from '@/lib/catalog';
import { getStorefrontCardsByIds } from '@/lib/storefront.server';
import { getDrawTicketInventory } from '@/lib/draw-tickets';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';

const getCardRewardsEnabled = cache(readCardRewardsEnabled);

export async function generateMetadata(): Promise<Metadata> {
  if (!await getCardRewardsEnabled()) {
    return { title: 'ICONS', robots: { index: false, follow: false } };
  }
  return {
    title: '카드팩 — ICONS',
    description: '굿즈를 구매하면 발급되는 카드팩을 개봉하고, 수집 카드를 바인더에 모아보세요.',
  };
}

export default async function Page() {
  if (!await getCardRewardsEnabled()) notFound();
  /* 카드 전량이 아니라 **보유 팩의 라인업**만 읽는다(규모 후속). 히어로는 라인업에서 고른다. */
  const inventory = await getDrawTicketInventory();
  const lineup = await getStorefrontCardsByIds(inventory.groups.flatMap((group) => group.lineupCardIds));
  return <CardPacks catalog={{ source: getCatalogSource(), ...lineup }} inventory={inventory} />;
}
