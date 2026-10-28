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
  });
  it('출고지마다 링크형 탭 하나에 한 출고지만 보이고, 변경 이력은 탭 아래 공통이다 (R22)', () => {
    const namyangju: FulfillmentOrigin = { ...origin, id: '00000000-0000-4000-8000-000000042202', code: 'namyangju', name: '남양주', exportTemplate: 'seowon_xlsx', baseFee: 3000 };
    const history = [{ id: 'h1', createdAt: '2026-10-01T00:00:00Z', actorName: '운영자', action: 'admin.fulfillment_origin.saved', diff: {} }] as never;
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, namyangju]} carriers={carriers} history={history} canEdit selected="namyangju" />);
    expect(html).toContain('<nav class="admin-console-tabs" aria-label="출고지">');
    expect(html).toContain('<a href="/admin/settings/origins?origin=gimpo">김포</a>');
    expect(html).toContain('<a aria-current="page" href="/admin/settings/origins?origin=namyangju">남양주</a>');
    expect(html).toContain('<a href="/admin/settings/origins?origin=_new">출고지 추가</a>');
    expect(html).toContain('value="3000"');
    expect(html).not.toContain('value="4700"');
    expect(html.indexOf('최근 변경 이력')).toBeGreaterThan(html.indexOf('admin-console-tabs'));
    const adding = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin, namyangju]} carriers={carriers} history={[]} canEdit selected="_new" />);
    expect(adding).toContain('<a aria-current="page" href="/admin/settings/origins?origin=_new">출고지 추가</a>');
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
