import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FulfillmentOriginsScreen } from './FulfillmentOriginsScreen';
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
  });
  it('allows admins to create and edit origins, with inactive-order impact explained', () => {
    const html = renderToStaticMarkup(<FulfillmentOriginsScreen origins={[origin]} carriers={carriers} history={[]} canEdit />);
    expect(html).toContain('출고지 추가');
    expect(html).toContain('기존 주문의 배송비는 바뀌지 않습니다');
    expect(html).toContain('readOnly=""');
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
