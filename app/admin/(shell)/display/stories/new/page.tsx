import { randomUUID } from 'node:crypto';
import { ShoppingStoryEditorScreen } from '@/components/admin/screens/ShoppingStoryEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
export default async function NewShoppingStoryPage() {
  const auth = await requireAdminScreenAccess('/admin/display/stories/new');
  return <ShoppingStoryEditorScreen accountId={auth.user.id} draftId={randomUUID()} initial={null} />;
}
