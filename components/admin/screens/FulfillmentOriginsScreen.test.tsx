import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FulfillmentOriginsScreen, selectedFulfillmentOriginTab } from './FulfillmentOriginsScreen';
import { GoodsFulfillmentFields } from '../GoodsFulfillmentFields';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
vi.mock('@/app/admin/fulfillment-actions', () => ({ saveFulfillmentOriginAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const origin: FulfillmentOrigin = { id:'00000000-0000-4000-8000-000000042201',code:'gimpo',name:'김포',defaultCarrier:'hanjin',baseFee:4700,freeThreshold:62000,returnAddress:'김포 주소',cutoff:'17:00',exportTemplate:'standard',active:true,updatedAt:'2026-09-01T00:00:00Z' };
const carriers = [{code:'hanjin',label:'한진택배',active:true,trackingUrlTemplate:'https://example.test/{trackingNumber}',updatedAt:'2026-09-01T00:00:00Z'}];
describe('origin settings workspace', () => {
  it('renders stored rates and disables all writes for staff', () => {
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={[]} canEdit={false} />);
    expect(html).toContain('value="4700"');
    expect(html).toContain('value="62000"');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).not.toContain('출고지 저장');
    expect(html).not.toContain('출고지 추가');
    expect(html).toContain('택배 외 수령 방식');
  });
  it('allows admins to create and edit origins', () => {
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={[]} canEdit />);
    expect(html).toContain('출고지 추가');
    expect(html).toContain('readOnly=""');
    /* kit 버튼의 기본 type은 button이다 — 출고지 저장은 제출 버튼이어야 한다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[\s\S])*출고지 저장<\/button>/);
  });
  it('출고지마다 링크형 탭 하나에 한 출고지만 보이고, 변경 이력은 탭 아래 공통이다 (R22)', () => {
    const namyangju: FulfillmentOrigin = { ...origin, id: '00000000-0000-4000-8000-000000042202', code: 'namyangju', name: '남양주', exportTemplate: 'seowon_xlsx', baseFee: 3000 };
    const history = [{ id: 'h1', createdAt: '2026-10-01T00:00:00Z', actorName: '운영자', action: 'admin.fulfillment_origin.saved', diff: {} }] as never;
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, namyangju]} carriers={carriers} history={history} canEdit selected="namyangju" />);
    /* 링크 탭: 현재 탭만 aria-current="page"이고 나머지는 표시가 없다. */
    const tabLink = (code: string, label: string, current: boolean) => new RegExp(`<a ${current ? 'aria-current="page"' : '(?![^>]*aria-current)'}[^>]*href="/admin/settings/origins\\?origin=${code}">${label}</a>`);
    expect(html).toMatch(/<nav aria-label="출고지"/);
    expect(html).toMatch(tabLink('gimpo', '김포', false));
    expect(html).toMatch(tabLink('namyangju', '남양주', true));
    expect(html).toMatch(tabLink('_new', '출고지 추가', false));
    expect(html).toContain('value="3000"');
    expect(html).not.toContain('value="4700"');
    expect(html.indexOf('최근 변경 이력')).toBeGreaterThan(html.indexOf('aria-label="출고지"'));
    const adding = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, namyangju]} carriers={carriers} history={[]} canEdit selected="_new" />);
    expect(adding).toMatch(tabLink('_new', '출고지 추가', true));
    expect(adding).not.toContain('value="4700"'); expect(adding).not.toContain('value="3000"');
    expect(adding).toContain('최근 변경 이력');
  });
  it('탭 값은 출고지 코드·출고지 추가(편집 권한)만 받고 그 밖은 첫 출고지로 돌린다', () => {
    const namyangju = { ...origin, code: 'namyangju' };
    expect(selectedFulfillmentOriginTab([origin, namyangju], 'namyangju', true)).toBe('namyangju');
    expect(selectedFulfillmentOriginTab([origin, namyangju], ['namyangju', 'gimpo'], true)).toBe('gimpo');
    expect(selectedFulfillmentOriginTab([origin, namyangju], 'unknown', true)).toBe('gimpo');
    expect(selectedFulfillmentOriginTab([origin, namyangju], undefined, true)).toBe('gimpo');
    expect(selectedFulfillmentOriginTab([origin], '_new', true)).toBe('_new');
    expect(selectedFulfillmentOriginTab([origin], '_new', false)).toBe('gimpo');
    expect(selectedFulfillmentOriginTab([], undefined, true)).toBe('_new');
    expect(selectedFulfillmentOriginTab([], undefined, false)).toBeNull();
  });
  it('화면 머리는 한 문장이고, 사용 여부는 사용 / 사용 안 함이다 (O-4·O-10)', () => {
    const inactive: FulfillmentOrigin = { ...origin, id: '00000000-0000-4000-8000-000000042202', code: 'namyangju', name: '남양주', active: false };
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, inactive]} carriers={carriers} history={[]} canEdit selected="gimpo" />);
    expect(html).toContain('출고지마다 기본 배송비와 택배사를 정합니다.');
    expect(html).not.toContain('주문서에서 함께 확인합니다');
    expect(html).toMatch(/남양주 · 사용 안 함<\/a>/);
    expect(html).toMatch(/data-tone="[a-z]+"[^>]*>사용<\/span>/);
    const other = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, inactive]} carriers={carriers} history={[]} canEdit selected="namyangju" />);
    expect(other).toMatch(/data-tone="[a-z]+"[^>]*>사용 안 함<\/span>/);
    expect(html + other).not.toMatch(/비활성|사용 중</);
    /* 관련 화면 이름은 메뉴 이름(지역별 추가배송비 관리)에서 '관리'만 뺀 같은 말이다. */
    expect(html).toContain('지역별 추가배송비');
    expect(html).not.toContain('지역 추가 배송비');
  });
  it('저장 전에 알릴 영향은 편집 권한이 있을 때만 폼에 넘긴다', () => {
    const impact = { goods: { publicGoods: 12, policyFeeGoods: 7 }, regionalFee: { managed: true, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: [] } };
    const inactive: FulfillmentOrigin = { ...origin, active: false };
    /* 사용 안 함인 출고지에 영향 안내가 새지 않는 것은 폼 시험이 본다. 여기서는 화면이 영향을 받아도 그리는 데 문제가 없는지만 본다. */
    expect(renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={[]} canEdit impact={impact} />)).toContain('출고지 저장');
    expect(renderToStaticMarkup(<FulfillmentOriginsScreen origins={[inactive]} carriers={carriers} history={[]} canEdit={false} impact={impact} />)).not.toContain('출고지 저장');
  });
  it('변경 이력은 폼의 칸 이름으로 보이고 빈 값은 없음이다 (O-16)', () => {
    const history = [{ id: 'h1', createdAt: '2026-10-01T00:00:00Z', actorName: '운영자', action: 'admin.fulfillment_origin.saved', target: 'fulfillment_origins:42201',
      diff: { before: { code: 'gimpo', is_active: true, return_address: '', free_threshold: null }, after: { code: 'gimpo', is_active: false, return_address: '새 주소', free_threshold: 50000 } } }];
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={history} canEdit />);
    expect(html).toMatch(/<th[^>]*>사용 여부<\/th><td[^>]*>사용<\/td><td[^>]*>사용 안 함<\/td>/);
    expect(html).toMatch(/<th[^>]*>반품 주소<\/th><td[^>]*>없음<\/td><td[^>]*>새 주소<\/td>/);
    expect(html).toMatch(/<th[^>]*>무료 배송 기준<\/th><td[^>]*>없음<\/td><td[^>]*>50000<\/td>/);
    expect(html).not.toMatch(/빈 값|새 발송 사용/);
  });
  it('preserves an explicitly empty draft origin and offers all three fee modes', () => {
    const html = renderToStaticMarkup(<GoodsFulfillmentFields origins={[origin]} value={{originId:null,shippingFeeType:'individual',individualFee:3700}} />);
    expect(html).toContain('<option value="" selected="">설정 전');
    expect(html).toContain('value="3700"');
    expect(html).toContain('value="policy"');
    expect(html).toContain('value="free"');
    /* 배송비 유형은 선택 카드(라디오)다. 고른 개별 배송비가 선택돼 있다. */
    expect(html).toMatch(/<input[^>]*name="shippingFeeType"[^>]*checked=""[^>]*value="individual"/);
  });
});
