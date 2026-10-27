import { ModerationSection } from '@/components/admin/sections/Moderation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminModerationRecords } from '@/lib/admin/moderation.server';

export default async function AdminCommunityModerationPage() {
  await requireAdminScreenAccess('/admin/community/moderation');

  const moderation = await getAdminModerationRecords();

  return <ModerationSection reports={moderation.reports} />;
}
