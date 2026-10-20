import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ShippingSettingsTemplatesScreen } from './ShippingSettingsTemplatesScreen';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { shippingFixtures, shippingIdentity, shippingIds } from '@/test/fixtures/shipping-settings';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipping-settings-template-actions', () => ({ saveShippingSettingsTemplateAction: vi.fn(), readShippingSettingsTemplateAction: vi.fn(),
  findShippingSettingsGoodsAction: vi.fn(), previewShippingSettingsTemplateAction: vi.fn(), applyShippingSettingsTemplateAction: vi.fn(), readShippingSettingsOperationAction: vi.fn(), sealShippingSettingsOperationAction: vi.fn() }));
it('배송 설정 템플릿과 안내 문구의 진입점을 구분하고 비활성 적용은 막는다', () => {
  const html = renderToStaticMarkup(<ShippingSettingsTemplatesScreen accountId={shippingIds.actor} origins={[]} regions={[]} data={{ filters: { query: '', state: 'all', page: 1 }, total: 1, rows: [{
    id: '00000000-0000-4000-8000-000000063211', name: '사용 중지 설정', revision: 3, enabled: false, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z',
    settings: { originId: '00000000-0000-4000-8000-000000042201', feeType: 'free', individualFee: 3000, claimPolicy: { returnAllowed: null, exchangeAllowed: null, restrictionReason: null, returnFee: null, returnFreeShippingFee: null, exchangeFee: null } },
  }] }} />);
  expect(html).toContain('배송정보 템플릿 관리'); expect(html).toContain('배송 안내 템플릿 관리'); expect(html).toContain('무료배송');
  expect(html).toMatch(/disabled="">상품 적용/); expect(html).toContain('이미 적용한 상품에 자동 반영되지 않습니다');
  expect(html).not.toContain('배송비 차감');
});
it('기존 템플릿은 수량·착불 정책 유지가 기본이며 명시적 적용과 구별한다', () => {
  const { template } = shippingFixtures(); const legacy = { ...template, settings: { ...template.settings, delivery: undefined } };
  const html = renderToStaticMarkup(<ShippingSettingsTemplateForm template={legacy} identity={shippingIdentity} scope={createGoodsDescriptionToolScope(shippingIds.actor)} origins={[]} regions={[]} onClose={() => {}} onSaved={() => {}} />);
  expect(html).toContain('상품에 저장된 확장 배송비 유지'); expect(html).toContain('사용 중인 수량별 배송비가 있으면 위 기본 배송비보다 우선합니다');
  expect(html).not.toContain('첫 번째 한도 초과 추가금');
});
it('템플릿의 3구간·선불/착불 선택은 기존 공용 입력 필드를 사용한다', () => {
  const { template, policy } = shippingFixtures();
  const html = renderToStaticMarkup(<ShippingSettingsTemplateForm template={{ ...template, settings: { ...template.settings, delivery: { mode: 'replace', policy } } }}
    identity={shippingIdentity} scope={createGoodsDescriptionToolScope(shippingIds.actor)} origins={[]} regions={[]} onClose={() => {}} onSaved={() => {}} />);
  for (const label of ['2구간 배송비', '3구간 배송비', '두 번째 수량 한도', '두 번째 한도 초과 추가금', '구매자 선택 · 선결제 또는 착불']) expect(html).toContain(label);
  expect(html).toContain('value="4"'); expect(html).toContain('기존 확장 배송비를 명시적으로 비활성화'); expect(html).not.toContain('복수구매 할인 상태');
});
it('사용 중인 수량 운임을 무료라는 기본 설정과 혼동하지 않는다', () => {
  const { effective } = shippingFixtures(); const html = renderToStaticMarkup(<ShippingSettingsDeliverySummary effective={effective} />);
  expect(html).toContain('<strong>수량별 배송비 적용'); expect(html).not.toContain('<strong>무료배송');
  for (const text of ['2개 이하 3,000원', '3~4개 4,000원', '5개 이상 5,000원', '무료배송', '현재 기본 운임 계산에는 사용하지 않습니다']) expect(html).toContain(text);
});
it('비활성 확장 정책은 기본 배송비·선결제로 계산함을 표시한다', () => {
  const { effective, policy } = shippingFixtures();
  const html = renderToStaticMarkup(<ShippingSettingsDeliverySummary effective={{ ...effective, delivery: { ...policy, status: 'disabled' } }} />);
  expect(html).toContain('<strong>무료배송 · 선결제</strong>'); expect(html).toContain('확장 배송비 사용 안 함'); expect(html).not.toContain('수량별 배송비 적용');
});
