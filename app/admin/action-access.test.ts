import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminCategoryAction, archiveAdminCategoryAction, saveAdminCategoryErpMappingAction, setAdminCategoryActivationAction, assignAdminGoodCategoryAction, saveAdminCategoryTypeMigrationAction } from './category-actions';
import { searchCouponTargetGoodsAction } from './coupon-target-actions';
import { cloneAdminGoodAction } from './good-clone-actions';
import { readGoodsAdditionalAction } from './goods-additional-actions';
import { readGoodsKcAction } from './goods-kc-actions';
import { listGoodsPreordersAction } from './goods-preorder-actions';
import { listGoodsPricePeriodsAction } from './goods-price-period-actions';
import { listGoodsPurchaseCostsAction } from './goods-purchase-cost-actions';
import { setGoodsVariantActiveAction } from './goods-variant-actions';
import { updateAdminIpIdentityAction } from './ip-identity-actions';
import { saveOperationsContactAction } from './operations-contact-actions';
import { prepareOrderDelayNoticeAction } from './order-delay-actions';
import { changeShipmentPreorderDateAction, readShipmentPreorderPromiseAction } from './preorder-shipment-actions';
import { createSettledExportAction } from './settled-export-actions';
import { readDeliveryPoliciesAction, readShipmentDeliveryAction, selectShipmentDeliveryMethodAction, recordShipmentDeliveryAction } from './shipment-delivery-actions';
import { saveShippingNoticeTemplateAction } from './shipping-notice-template-actions';
import { saveShippingRegionPolicyAction } from './shipping-region-actions';
import { adjustStoreCreditAction, saveStoreCreditPolicyAction } from './store-credit-actions';
import { saveInquiryAutoRepliesAction } from './store-settings-actions';
import { saveGoodsNoticePresetAction } from './goods-notice-preset-actions';
import { setAdminGoodPublishedAction } from './goods-publish-actions';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
// 실제 Next redirect/unstable_rethrow를 사용해 catch가 로그인 이동을 삼키는 회귀도 잡는다.
const form = () => new FormData();
const orderId = '00000000-0000-4000-8000-000000000001';
const orderPath = `/admin/sales/orders/${orderId}`;
const orderForm = () => { const data = form(); data.set('orderId', orderId); return data; };
const goodsPath = '/admin/catalog/goods';
const categoryPath = '/admin/catalog/categories';
const cases: { name: string; path: string; run: () => Promise<unknown> }[] = [
  { name: '분류 저장', path: categoryPath, run: () => saveAdminCategoryAction({}, form()) },
  { name: '분류 보관', path: categoryPath, run: () => archiveAdminCategoryAction({}, form()) },
  { name: 'ERP 분류', path: categoryPath, run: () => saveAdminCategoryErpMappingAction({}, form()) },
  { name: '분류 활성화', path: categoryPath, run: () => setAdminCategoryActivationAction({}, form()) },
  { name: '대표 분류', path: categoryPath, run: () => assignAdminGoodCategoryAction({}, form()) },
  { name: '유형 이관', path: categoryPath, run: () => saveAdminCategoryTypeMigrationAction({}, form()) },
  { name: '쿠폰 상품 검색', path: '/admin/sales/coupons', run: () => searchCouponTargetGoodsAction('') },
  { name: '상품 복사', path: goodsPath, run: () => cloneAdminGoodAction({}, form()) },
  { name: '추가 구성', path: goodsPath, run: () => readGoodsAdditionalAction('') },
  { name: 'KC 조회', path: goodsPath, run: () => readGoodsKcAction('') },
  { name: '예약판매', path: goodsPath, run: () => listGoodsPreordersAction('') },
  { name: '기간 할인', path: goodsPath, run: () => listGoodsPricePeriodsAction('') },
  { name: '매입단가', path: goodsPath, run: () => listGoodsPurchaseCostsAction('') },
  { name: '옵션 사용 상태', path: goodsPath, run: () => setGoodsVariantActiveAction({}, form()) },
  { name: 'IP 주소', path: '/admin/catalog/ips/ip1', run: () => { const data = form(); data.set('id', 'ip1'); return updateAdminIpIdentityAction({}, data); } },
  { name: '운영 연락처', path: '/admin/settings/operations', run: () => saveOperationsContactAction({}, form()) },
  { name: '지연 안내', path: '/admin/sales/dispatch', run: () => prepareOrderDelayNoticeAction({ requestId: '', shipmentIds: [], title: '', body: '', expectedShipDate: null }) },
  { name: '예약 발송일', path: orderPath, run: () => readShipmentPreorderPromiseAction('', orderId) },
  { name: '거래확정 내보내기', path: '/admin/sales/settled', run: () => createSettledExportAction({}, form()) },
  { name: '배송 인계', path: orderPath, run: () => readShipmentDeliveryAction('', orderId) },
  { name: '출고지 배송 정책', path: '/admin/settings/origins', run: () => readDeliveryPoliciesAction('') },
  { name: '배송 방식 변경', path: orderPath, run: () => selectShipmentDeliveryMethodAction(orderForm()) },
  { name: '인계 기록', path: orderPath, run: () => recordShipmentDeliveryAction(orderForm()) },
  { name: '예약 발송일 변경', path: orderPath, run: () => changeShipmentPreorderDateAction(orderForm()) },
  { name: '고객 적립금', path: `/admin/customers/${orderId}/store-credits`, run: () => { const data = form(); data.set('userId', orderId); return adjustStoreCreditAction({}, data); } },
  { name: '배송 안내 템플릿', path: '/admin/settings/shipping-notices', run: () => saveShippingNoticeTemplateAction({}, form()) },
  { name: '지역 배송비', path: '/admin/settings/shipping-regions', run: () => saveShippingRegionPolicyAction(null, null, {}) },
  { name: '적립금 정책', path: '/admin/settings/store-credits', run: () => saveStoreCreditPolicyAction({}, form()) },
  { name: '문의 자동 안내', path: '/admin/settings/store', run: () => saveInquiryAutoRepliesAction({}, form()) },
  { name: '고시 프리셋', path: '/admin/catalog/notice-presets', run: () => saveGoodsNoticePresetAction({}, form()) },
  { name: '상품 게시', path: goodsPath, run: () => setAdminGoodPublishedAction({}, form()) },
];
beforeEach(() => vi.clearAllMocks());

describe('최근 영업 운영 액션의 공통 접근 계약 (#504)', () => {
  it.each(cases)('$name 미로그인은 잘못된 입력이어도 해당 화면으로 복귀한다', async ({ run, path }) => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, role: null, isStaff: false });
    await expect(run()).rejects.toMatchObject({ digest: expect.stringContaining(`/login?next=${encodeURIComponent(path)}`) });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(cases)('$name 비운영자는 DB에 닿지 않고 폼 오류를 받는다', async ({ run }) => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, role: 'user', isStaff: false });
    const result = await run() as { error?: string; errors?: { form?: string } };
    expect(result.error ?? result.errors?.form).toEqual(expect.any(String));
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
