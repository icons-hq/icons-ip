import { CouponScreen } from '../../components/admin/screens/CouponScreen';
import { normalizeAdminCouponFilters, couponPhase, type AdminCouponRecord } from '../../lib/admin/coupons';
const records: AdminCouponRecord[] = [
  { id: 'FIXTURE-AUTUMN', code: 'FIXTURE-AUTUMN', name: '가을 컬렉션 3천원 할인', discountType: 'fixed', discountValue: 3000, maxDiscountAmount: null, minSubtotal: 30000, startsAt: '2026-10-01T00:00:00+09:00', endsAt: '2026-12-31T23:59:59+09:00', issueLimit: 500, issuedCount: 28, usedCount: 12, status: 'active', gradeBenefit: null, termsRevision: 1, recipientSegment: 'all', goodsScope: 'all', targetGoodIds: [], targetGoods: [] },
  { id: 'FIXTURE-FIRST', code: 'FIXTURE-FIRST', name: '첫구매 10% 할인', discountType: 'percent', discountValue: 10, maxDiscountAmount: 5000, minSubtotal: 10000, startsAt: '2026-11-01T00:00:00+09:00', endsAt: '2026-11-30T23:59:59+09:00', issueLimit: null, issuedCount: 0, usedCount: 0, status: 'active', gradeBenefit: null, termsRevision: 1, recipientSegment: 'first_purchase', goodsScope: 'all', targetGoodIds: [], targetGoods: [] },
];
export function CouponsFixture() {
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  const mode = window.location.pathname.endsWith('/new') || query.mode === 'create' ? 'create' : 'list';
  const filters = normalizeAdminCouponFilters({ ...query, couponCode: mode === 'create' ? query.copy : query.couponCode });
  const matched = records.filter(record => (!filters.query || `${record.name} ${record.code}`.includes(filters.query)) && (!filters.phase || couponPhase(record) === filters.phase));
  return <CouponScreen mode={mode} data={{ filters, records: matched, selectedRecord: records.find(record => record.code === filters.selectedCode) ?? null, total: matched.length, pageSize: filters.pageSize ?? 20 }} />;
}
