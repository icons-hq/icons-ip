import type { Metadata } from 'next';
import { ShoppingStoriesScreen } from '@/components/screens/ShoppingStories';
import { getPublicShoppingStories } from '@/lib/shopping-stories.server';
export const metadata: Metadata = { title: '쇼핑스토리 — ICONS', description: '좋아하는 IP와 굿즈를 만나는 쇼핑스토리.' };
export default async function ShoppingStoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = typeof query.page === 'string' && /^[1-9]\d*$/.test(query.page) ? Number(query.page) : 1;
  return <ShoppingStoriesScreen data={await getPublicShoppingStories({ page })} />;
}
