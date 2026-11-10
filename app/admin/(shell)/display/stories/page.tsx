import { ShoppingStoriesAdminScreen } from '@/components/admin/screens/ShoppingStoriesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeShoppingStoryFilters } from '@/lib/admin/shopping-stories';
import { loadAdminShoppingStories } from '@/lib/admin/shopping-stories.server';
export default async function ShoppingStoriesAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess('/admin/display/stories');
  const data = await loadAdminShoppingStories(normalizeShoppingStoryFilters(await searchParams));
  return <ShoppingStoriesAdminScreen key={data.checkedAt} data={data} />;
}
