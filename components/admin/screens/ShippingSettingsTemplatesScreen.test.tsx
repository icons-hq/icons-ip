import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ShippingSettingsTemplatesScreen } from './ShippingSettingsTemplatesScreen';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { ShippingSettingsFulfillmentSummary } from './ShippingSettingsFulfillmentFields';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { shippingFixtures, shippingIdentity, shippingIds } from '@/test/fixtures/shipping-settings';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipping-settings-template-actions', () => ({ saveShippingSettingsTemplateAction: vi.fn(), readShippingSettingsTemplateAction: vi.fn(),
  findShippingSettingsOutdatedGoodsAction: vi.fn(), previewShippingSettingsTemplateAction: vi.fn(), applyShippingSettingsTemplateAction: vi.fn(), readShippingSettingsOperationAction: vi.fn(), sealShippingSettingsOperationAction: vi.fn() }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));
vi.mock('@/app/admin/shipping-charge-group-actions', () => ({ getShippingChargeGroupAction: vi.fn(), listShippingChargeGroupsAction: vi.fn() }));

const origin = (patch: Partial<GoodsFulfillmentOrigin> = {}): GoodsFulfillmentOrigin => ({ id: shippingIds.origin, name: '김포 출고지', defaultCarrier: 'hanjin', baseFee: 3000, freeThreshold: 50000, returnAddress: '', active: true, ...patch });
const form = (props: Partial<Parameters<typeof ShippingSettingsTemplateForm>[0]> = {}) => renderToStaticMarkup(<ShippingSettingsTemplateForm identity={shippingIdentity}
  scope={createGoodsDescriptionToolScope(shippingIds.actor)} origins={[]} regions={[]} onClose={() => {}} onSaved={() => {}} {...props} />);
/** 이름표(data 속성)가 붙은 태그 하나의 여는 부분. */
const tag = (html: string, marker: string) => html.match(new RegExp(`<[^>]*${marker}[^>]*>`))?.[0] ?? '';

it('목록은 템플릿이 정한 배송비와 적용 상품 수를 보이고 내부 번호·버전은 내보이지 않는다', () => {
  const { template } = shippingFixtures();
  const html = renderToStaticMarkup(<ShippingSettingsTemplatesScreen accountId={shippingIds.actor} origins={[origin()]} regions={[]} data={{ filters: { query: '', state: 'all', page: 1 }, total: 2,
    usage: { [template.id]: { applied: 12, outdated: 3 } }, rows: [{ ...template, revision: 7, settings: { ...template.settings, feeType: 'policy' } }, {
      id: '00000000-0000-4000-8000-000000063211', name: '사용 중지 설정', revision: 3, enabled: false, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z',
      settings: { originId: '00000000-0000-4000-8000-000000042201', feeType: 'free', individualFee: 3000, claimPolicy: { returnAllowed: null, exchangeAllowed: null, restrictionReason: null, returnFee: null, returnFreeShippingFee: null, exchangeFee: null } },
    }] }} />);
  expect(html).toContain('배송정보 템플릿 관리'); expect(html).toContain('배송 안내 템플릿 관리'); expect(html).toContain('출고지·배송비·반품 조건을 묶어 두고 여러 상품에 한 번에 넣는 설정입니다.');
  expect(html).toContain('출고지 정책 따름 · 3,000원 · 50,000원 이상 무료'); expect(html).toContain('무료배송');
  /* 적용 상품 수와, 고친 뒤 다시 적용하지 않은 상품을 맞추는 길. 수를 세지 못한 템플릿은 수를 보이지 않는다. */
  expect(html).toContain('12개'); expect(html).toContain('3개는 고치기 전 내용'); expect(html).toMatch(/<button[^>]*>다시 적용<\/button>/);
  expect(html).toMatch(/data-shipping-template-usage="">—</);
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>상품에 적용<\/button>/); expect(html).toContain('바꿔야 적용할 수 있습니다');
  expect(html).toContain('2026.10.12');
  for (const gone of ['이미 적용한 상품에 자동 반영되지 않습니다', '버전', '00000000-0000-4000-8000-000000063211', shippingIds.template, '배송비 차감', '출고지·배송정보 관리', '미확정']) expect(html).not.toContain(gone);
});
it('쇼핑몰 주문 설정이 꺼져 있으면 적용할 수 없는 템플릿의 [상품에 적용]을 까닭과 함께 막는다', () => {
  const { template, policy } = shippingFixtures();
  const rows = [{ ...template, settings: { ...template.settings, delivery: { mode: 'replace' as const, policy }, chargeGroup: { mode: 'clear' as const } } }];
  const screen = (runtimeEnabled: boolean | null) => renderToStaticMarkup(<ShippingSettingsTemplatesScreen accountId={shippingIds.actor} origins={[origin()]} regions={[]} runtimeEnabled={runtimeEnabled}
    data={{ filters: { query: '', state: 'all', page: 1 }, total: 1, rows }} />);
  expect(screen(false)).toContain('지금 쇼핑몰 설정에서는 적용할 수 없습니다. [수정]에서 함께 바꾸는 것(수량별·착불 설정, 묶음그룹)을 끄면 적용할 수 있습니다');
  expect(screen(false)).toContain('함께 바꾸는 것: 수량별·착불 설정, 묶음그룹');
  for (const runtime of [true, null]) expect(screen(runtime)).not.toContain('지금 쇼핑몰 설정에서는');
  expect(renderToStaticMarkup(<ShippingSettingsTemplatesScreen accountId={shippingIds.actor} origins={[origin({ active: false })]} regions={[]}
    data={{ filters: { query: '', state: 'all', page: 1 }, total: 1, rows: [template] }} />)).toContain('출고지가 사용 안 함이라 적용할 수 없습니다');
});
it('편집 창은 고른 것에 필요한 입력만 열고, 체크하지 않은 것은 상품의 설정을 그대로 둔다고 말한다', () => {
  const { template } = shippingFixtures(); const legacy = { ...template, settings: { ...template.settings, delivery: undefined } };
  const html = form({ template: legacy, origins: [origin(), origin({ id: shippingIds.other, name: '안 쓰는 출고지', active: false })] });
  expect(html).toContain('이 템플릿이 함께 바꾸는 것'); expect(html).toContain('체크하지 않은 것은 상품에 있는 설정을 그대로 둡니다.');
  for (const name of ['delivery', 'chargeGroup', 'fulfillment']) expect(tag(html, `data-shipping-extra-toggle="${name}"`)).not.toContain('checked');
  for (const closed of ['첫 구간을 넘으면 더하는 금액', '그보다 많으면 더하는 금액', '묶음그룹에서 빼기', '상품 제공 방식', '고객 안내 (선택)']) expect(html).not.toContain(closed);
  /* 배송비 유형은 선택 카드, 금액 칸은 '개별 배송비'일 때만 보인다(값은 폼에 남는다). */
  expect(html).toContain('data-good-choice="cards"'); expect(tag(html, 'value="free"')).toContain('checked');
  expect(html).toMatch(/<div class="sm:col-span-2" hidden="">.*name="individualFee"[^>]*value="3500"/);
  /* 고객이 내는 배송비를 한 줄로 되읽는다. */
  expect(html).toContain('이 템플릿을 쓴 상품 · 배송비 무료'); expect(html).toContain('상품에 수량별 배송비가 켜져 있으면 그 금액을 먼저 받습니다.');
  /* 사용 안 하는 출고지는 새로 고를 수 없다. */
  expect(html).toContain('김포 출고지</option>'); expect(html).not.toContain('안 쓰는 출고지');
  /* 반품·교환 칸은 상품등록과 같은 말이다. */
  expect(html).toContain('미검토 · 기본 정책 확인'); expect(html).toContain('placeholder="비우면 &#x27;확인 후 안내&#x27;, 무료면 0"');
  expect(html).toContain('여기 적은 조건과 금액은 상품 상세에 보이는 안내입니다.');
  for (const gone of ['버전', '최신 저장본', '적용 근거', '확인했습니다', '반송 주소', '미처리 요청', '비활성']) expect(html).not.toContain(gone);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>저장<\/button>/); expect(html).toMatch(/<button[^>]*type="button"[^>]*>닫기<\/button>/);
});
it('출고지 정책 따름은 그 출고지의 금액으로 되읽고, 이미 저장된 사용 안 하는 출고지는 까닭과 함께 남긴다', () => {
  const { template } = shippingFixtures();
  const policy = { ...template, settings: { ...template.settings, feeType: 'policy' as const } };
  expect(form({ template: policy, origins: [origin()] })).toContain('이 템플릿을 쓴 상품 · 배송비 3,000원 · 50,000원 이상 무료');
  const inactive = form({ template: policy, origins: [origin({ active: false })] });
  expect(inactive).toContain('김포 출고지 · 사용 안 함</option>'); expect(inactive).toContain('사용 안 하는 출고지라 이 템플릿은 상품에 적용할 수 없습니다.');
  const individual = form({ template: { ...template, settings: { ...template.settings, feeType: 'individual' as const } }, origins: [origin()] });
  expect(individual).toContain('이 템플릿을 쓴 상품 · 배송비 3,500원'); expect(individual).not.toMatch(/<div class="sm:col-span-2" hidden="">/);
});
it('수량별·착불 설정을 체크한 템플릿은 3구간·선불/착불 입력을 연다', () => {
  const { template, policy } = shippingFixtures();
  const html = form({ template: { ...template, settings: { ...template.settings, delivery: { mode: 'replace', policy } } } });
  expect(tag(html, 'data-shipping-extra-toggle="delivery"')).toContain('checked');
  for (const label of ['2구간 배송비', '3구간 배송비', '둘째 구간 (개까지)', '둘째 구간을 넘으면 더하는 금액 (원)', '구매자 선택 · 선결제 또는 착불']) expect(html).toContain(label);
  expect(html).toContain('value="4"'); expect(html).toContain('상품에 있던 수량별·착불 설정을 끄고'); expect(html).not.toContain('복수구매 할인 상태');
  expect(html).not.toContain('상품에 수량별 배송비가 켜져 있으면');
  /* 수량별 배송비를 '사용'으로 함께 바꾸면 되읽기도 그 금액을 먼저 말한다(배송비 유형의 금액이 아니다). */
  expect(html).toMatch(/data-shipping-readback="delivery">.*수량별 배송비 · 구매자 선택 · 선결제 또는 착불.*2개 이하 3,000원/);
  const off = form({ template: { ...template, settings: { ...template.settings, delivery: { mode: 'replace', policy: { ...policy, status: 'disabled' } } } } });
  expect(off).toContain('이 템플릿을 쓴 상품 · 배송비 무료'); expect(off).not.toContain('data-shipping-readback="delivery"');
});
it('수령 방식을 체크한 템플릿은 적용 근거·확인 체크 없이 받을 방식만 묻고 한 줄로 되읽는다', () => {
  const { template } = shippingFixtures();
  /* 예전에 저장된 템플릿에는 근거와 확인 체크가 남아 있다. 화면에는 내보이지 않는다. */
  const fulfillment = { mode: 'replace' as const, policy: { mode: 'shipping' as const, methods: [{ method: 'parcel' as const, feeAmount: null, feeBasis: 'per_order' as const, installationFee: 0 },
    { method: 'quick' as const, feeAmount: 5000, feeBasis: 'per_item' as const, installationFee: 0 }], publicNote: '설치 기사가 방문합니다', evidence: '옛 근거', confirmed: true } };
  const html = form({ template: { ...template, settings: { ...template.settings, fulfillment } } });
  expect(tag(html, 'data-shipping-extra-toggle="fulfillment"')).toContain('checked');
  for (const label of ['상품 제공 방식', '배송 또는 방문수령', '배송없음 · 직접전달', '선결제 배송비 (원)', '배송비 계산 단위', '수량 1개당 선결제 설치비 (원)', '고객 안내 (선택)']) expect(html).toContain(label);
  expect(html).toContain('고객은 주문서에서 택배, 퀵(배송비 수량 1개마다 5,000원) 중 하나를 고릅니다.');
  expect(html).toContain('택배 외 방식은 <a'); expect(html).toContain('적용하면 상품에 연결해 둔 디지털 파일이 새 주문부터 빠집니다.');
  for (const gone of ['옛 근거', '적용 근거', '확인했습니다', '출고지·배송정보 관리']) expect(html).not.toContain(gone);
});
it('사용 중인 수량 운임을 무료라는 기본 설정과 혼동하지 않는다', () => {
  const { effective } = shippingFixtures(); const html = renderToStaticMarkup(<ShippingSettingsDeliverySummary effective={effective} />);
  expect(html).toContain('<strong>수량별 배송비 · 구매자 선택 · 선결제 또는 착불</strong>'); expect(html).not.toContain('<strong>무료배송');
  for (const text of ['2개 이하 3,000원', '3~4개 4,000원', '5개 이상 5,000원', '수량별 배송비를 쓰는 동안 ‘무료배송’은 쓰지 않습니다.']) expect(html).toContain(text);
});
it('수량별·착불 설정을 쓰지 않으면 배송비 유형과 선결제로 받는다고 보이고, 출고지 정책 따름에는 금액을 붙인다', () => {
  const { effective, policy } = shippingFixtures();
  const html = renderToStaticMarkup(<ShippingSettingsDeliverySummary effective={{ ...effective, delivery: { ...policy, status: 'disabled' } }} />);
  expect(html).toContain('<strong>무료배송 · 선결제</strong>'); expect(html).toContain('수량별·착불 설정 사용 안 함'); expect(html).not.toContain('수량별 배송비');
  expect(renderToStaticMarkup(<ShippingSettingsDeliverySummary effective={{ ...effective, feeType: 'policy', delivery: null }} origin={{ baseFee: 3000, freeThreshold: null }} />))
    .toContain('<strong>출고지 정책 따름 · 3,000원 · 선결제</strong>');
});
it('상품의 수령 방식은 상품등록과 같은 문장으로 보인다', () => {
  expect(renderToStaticMarkup(<ShippingSettingsFulfillmentSummary value={{ mode: 'digital', methods: [{ method: 'digital', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }],
    files: [{ id: shippingIds.other, name: '합성.pdf', mimeType: 'application/pdf', size: 10 }], publicNote: '' }} />)).toContain('디지털 파일 1개를 내려받습니다.');
  expect(renderToStaticMarkup(<ShippingSettingsFulfillmentSummary value={{ mode: 'no_delivery', methods: [{ method: 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }], files: [], publicNote: '매장에서 드립니다' }} />))
    .toContain('배송비 없이 주문받고 직접 전달합니다.</span><span class="text-xs leading-relaxed font-normal text-muted-foreground">고객 안내: 매장에서 드립니다');
});
