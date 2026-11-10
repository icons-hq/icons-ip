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
    expect(html).toContain('배송·직접전달 운영 조건');
  });
  it('allows admins to create and edit origins, with inactive-order impact explained', () => {
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={[]} canEdit />);
    expect(html).toContain('출고지 추가');
    expect(html).toContain('기존 주문의 배송비는 바뀌지 않습니다');
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
  it('preserves an explicitly empty draft origin and offers all three fee modes', () => {
    const html = renderToStaticMarkup(<GoodsFulfillmentFields origins={[origin]} value={{originId:null,shippingFeeType:'individual',individualFee:3700}} />);
    expect(html).toContain('<option value="" selected="">설정 전');
    expect(html).toContain('value="3700"');
    expect(html).toContain('value="policy"');
    expect(html).toContain('value="free"');
    expect(html).toContain('value="individual" selected=""');
  });
});
