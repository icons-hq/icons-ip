import { notFound } from 'next/navigation';
import { ShoppingStoryEditorScreen } from '@/components/admin/screens/ShoppingStoryEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminShoppingStory } from '@/lib/admin/shopping-stories.server';
import { isUuid } from '@/lib/uuid';
export default async function EditShoppingStoryPage({ params }: { params: Promise<{ storyId: string }> }) {
  const auth = await requireAdminScreenAccess('/admin/display/stories');
  const { storyId } = await params;
  if (!isUuid(storyId)) notFound();
  const story = await loadAdminShoppingStory(storyId);
  if (!story) notFound();
  return <ShoppingStoryEditorScreen accountId={auth.user.id} draftId={story.id} initial={story} />;
}
