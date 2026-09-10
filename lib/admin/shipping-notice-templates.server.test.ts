import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveShippingNoticeTemplateOptions } from './shipping-notice-templates.server';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), range: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  mocks.range.mockReset().mockResolvedValue({ data: [{
    id: 'template-1', code: 'basic', version: 1, name: '기본', shipping_notice: '배송',
    return_exchange_notice: '반품', cs_name: 'CS', cs_phone: '02', cs_email: 'help@example.com',
    status: 'active', confirmed_by: 'staff', confirmed_at: '2026-09-10T00:00:00Z',
    confirmation_evidence: 'private', created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-10T00:00:00Z',
  }], error: null });
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, range: mocks.range };
  mocks.createClient.mockResolvedValue({ from: () => query });
});

describe('활성 배송정보 템플릿 옵션 로더', () => {
  it('전체 활성 버전을 읽고 내부 확인 근거를 반환하지 않는다', async () => {
    const options = await loadActiveShippingNoticeTemplateOptions();
    expect(options).toEqual([{
      id: 'template-1', code: 'basic', version: 1, name: '기본', shippingNotice: '배송',
      returnExchangeNotice: '반품', csName: 'CS', csPhone: '02', csEmail: 'help@example.com',
    }]);
    expect(JSON.stringify(options)).not.toContain('private');
    expect(mocks.range).toHaveBeenCalledWith(0, 999);
  });
});
