import { ClaimQueueScreen } from '../../components/admin/screens/ClaimQueueScreen';
import { OrderItemsScreen } from '../../components/admin/screens/OrderItemsScreen';
import { normalizeAdminClaimFilters, type AdminClaimConsoleData, type AdminClaimRow } from '../../lib/admin/claims';
import { normalizeAdminOrderItemFilters, type AdminOrderItemData, type AdminOrderItemRow } from '../../lib/admin/order-items';
import { isOpenOrderClaimStage } from '../../lib/orders/claims';

const NOW = new Date('2026-10-16T01:00:00Z');
const ORDER_ROWS: AdminOrderItemRow[] = Array.from({ length: 6 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000008000${index + 1}`,
  orderId: `00000000-0000-4000-8000-00000008100${Math.floor(index / 2) + 1}`,
  orderNumber: `202610${15 - Math.floor(index / 2)}1${String(Math.floor(index / 2) + 1).padStart(7, '0')}`,
  productOrderNumber: `202610${15 - Math.floor(index / 2)}2${String(index + 1).padStart(7, '0')}`,
  userId: `00000000-0000-4000-8000-00000008200${Math.floor(index / 2) + 1}`,
  buyerName: `합성구매자 ${Math.floor(index / 2) + 1}`, recipientName: `합성수취인 ${Math.floor(index / 2) + 1}`,
  status: (['paid', 'paid', 'confirmed', 'confirmed', 'shipping', 'delivered'] as const)[index],
  createdAt: `2026-10-${String(15 - Math.floor(index / 2)).padStart(2, '0')}T02:00:00Z`,
  goodId: `fixture-good-${index + 1}`, goodName: `[합성] ${['캐릭터 아크릴 키링', '미니 포토카드 세트', '피크닉 토트백'][index % 3]}`,
  variantName: index % 2 ? '블루 / 기본 구성' : '화이트 / 기본 구성', variantCode: `FIXTURE-OPT-${index + 1}`,
  customInputs: null, qty: index % 2 + 1, unitPrice: 12000 + index * 1000,
  itemAmount: (index % 2 + 1) * (12000 + index * 1000),
  shipmentId: `00000000-0000-4000-8000-00000008300${Math.floor(index / 2) + 1}`,
  shipmentStatus: index === 4 ? 'shipping' : index === 5 ? 'delivered' : 'ready',
  originName: '[합성] 기본 출고지', trackingNumber: index >= 4 ? `FIXTURE-TRACK-${index + 1}` : null,
  carrierLabel: index >= 4 ? '합성 택배' : null, claim: null,
}));
const CLAIM_ROWS: AdminClaimRow[] = Array.from({ length: 4 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000008400${index + 1}`,
  reference: 1004 - index, orderId: `00000000-0000-4000-8000-00000008100${index + 1}`,
  orderNumber: `202610${15 - index}1${String(index + 1).padStart(7, '0')}`,
  claimType: 'return', stage: (['requested', 'collecting', 'on_hold', 'processing'] as const)[index],
  reasonType: index % 2 ? 'defect' : 'change_of_mind', staffReasonCode: null, buyerName: `합성구매자 ${index + 1}`, buyerEmail: null,
  orderStatus: 'delivered', orderTotal: 24000 + index * 12000,
  requestedAt: `2026-10-${15 - index}T02:00:00Z`,
  collectedAt: index === 3 ? '2026-10-12T02:00:00Z' : null, completedAt: null,
  refundMethod: index === 3 ? 'pg_cancel' : null, handlerName: index > 1 ? '합성담당자' : null,
}));

export function OrderItemsFixture() {
  const filters = normalizeAdminOrderItemFilters(Object.fromEntries(new URLSearchParams(window.location.search)));
  const matching = ORDER_ROWS.filter(row => (filters.status === 'all' || row.status === filters.status)
    && `${row.id} ${row.orderNumber} ${row.productOrderNumber} ${row.goodName} ${row.buyerName}`.includes(filters.query));
  const pageSize = filters.pageSize ?? 20;
  const data: AdminOrderItemData = {
    filters, rows: matching.slice((filters.page - 1) * pageSize, filters.page * pageSize), total: matching.length,
    orderCount: new Set(matching.map(row => row.orderId)).size, qty: matching.reduce((sum, row) => sum + row.qty, 0),
    fingerprint: '0'.repeat(32), counts: { pending: 0, paid: 2, confirmed: 2, shipping: 1, delivered: 1, done: 0, canceled: 0 },
  };
  return <OrderItemsScreen data={data} canManage />;
}

export function ReturnClaimsFixture() {
  const filters = normalizeAdminClaimFilters(Object.fromEntries(new URLSearchParams(window.location.search)));
  const matching = CLAIM_ROWS.filter(row => (filters.stage === 'all' || (filters.stage === 'open' ? isOpenOrderClaimStage(row.stage) : row.stage === filters.stage))
    && (filters.reasonType === 'all' || row.reasonType === filters.reasonType)
    && `${row.reference} ${row.orderId} ${row.orderNumber} ${row.buyerName}`.includes(filters.query));
  const pageSize = filters.pageSize ?? 20;
  const data: AdminClaimConsoleData = {
    claimType: 'return', filters, rows: matching.slice((filters.page - 1) * pageSize, filters.page * pageSize), total: matching.length, pageSize,
    counts: { requested: 1, in_review: 0, collecting: 1, collected: 0, on_hold: 1, processing: 1, needs_review: 0, completed: 0, rejected: 0, withdrawn: 0 },
  };
  return <ClaimQueueScreen data={data} now={NOW} />;
}
