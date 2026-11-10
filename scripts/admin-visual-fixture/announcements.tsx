import { GoodsAnnouncementsScreen } from '../../components/admin/screens/GoodsAnnouncementsScreen';
import { GoodsAnnouncementEditor } from '../../components/admin/screens/GoodsAnnouncementEditor';
import { GoodAnnouncements } from '../../components/shop/GoodAnnouncements';
import { blankGoodsAnnouncement, goodsAnnouncementState, normalizeGoodsAnnouncementFilters } from '../../lib/admin/goods-announcements';
import { ANNOUNCEMENT_FIXTURE_ACCOUNT_ID, ANNOUNCEMENT_FIXTURE_ID, readAnnouncementFixture } from './announcement-actions';

export function GoodsAnnouncementsFixture({ publicView = false }: { publicView?: boolean }) {
  const params = new URLSearchParams(window.location.search); const saved = readAnnouncementFixture();
  if (publicView) return <div className="wc-root" style={{ maxWidth: 1000, margin: '0 auto' }}><p>합성 공지의 공개 화면 검수</p><GoodAnnouncements data={{ items: goodsAnnouncementState(saved) === 'shown' ? [saved] : [], nextChangeAt: null }} /></div>;
  if (params.has('create') || params.has('edit')) return <GoodsAnnouncementEditor key={params.has('create') ? 'new' : saved.id} accountId={ANNOUNCEMENT_FIXTURE_ACCOUNT_ID} persistPending={false} announcement={params.has('create') ? blankGoodsAnnouncement('00000000-0000-4000-8000-000000072002') : saved} backHref="/admin/catalog/announcements" />;
  const filters = normalizeGoodsAnnouncementFilters(Object.fromEntries(params));
  return <GoodsAnnouncementsScreen data={{ rows: [{ ...saved, id: ANNOUNCEMENT_FIXTURE_ID, state: goodsAnnouncementState(saved), goodCount: saved.goods.length }], total: 1, filters }} />;
}
