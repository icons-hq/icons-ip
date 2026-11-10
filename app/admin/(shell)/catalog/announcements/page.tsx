import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isUuid } from '@/lib/uuid';
import { goodsAnnouncementHref, GOODS_ANNOUNCEMENTS_PATH, normalizeGoodsAnnouncementFilters } from '@/lib/admin/goods-announcements';
import { loadGoodsAnnouncement, loadGoodsAnnouncements } from '@/lib/admin/goods-announcements.server';
import { GoodsAnnouncementsScreen } from '@/components/admin/screens/GoodsAnnouncementsScreen';
import { GoodsAnnouncementEditor } from '@/components/admin/screens/GoodsAnnouncementEditor';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireAdminScreenAccess(GOODS_ANNOUNCEMENTS_PATH);
  const params = await searchParams; const filters = normalizeGoodsAnnouncementFilters(params);
  if (params.create === '1') redirect(`${goodsAnnouncementHref(filters)}&create=${randomUUID()}`);
  if (typeof params.create === 'string') {
    if (!isUuid(params.create)) notFound();
    const announcement = await loadGoodsAnnouncement(params.create, true); if (!announcement) notFound();
    return <GoodsAnnouncementEditor key={`${user.id}:${announcement.id}`} accountId={user.id} announcement={announcement} backHref={goodsAnnouncementHref(filters)} />;
  }
  if (typeof params.edit === 'string') {
    if (!isUuid(params.edit)) notFound();
    const announcement = await loadGoodsAnnouncement(params.edit); if (!announcement) notFound();
    return <GoodsAnnouncementEditor key={`${user.id}:${announcement.id}`} accountId={user.id} announcement={announcement} backHref={goodsAnnouncementHref(filters)} />;
  }
  return <GoodsAnnouncementsScreen data={await loadGoodsAnnouncements(filters)} />;
}
