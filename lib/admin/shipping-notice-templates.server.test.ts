import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadActiveShippingNoticeTemplateOptions, loadShippingNoticeTemplate, loadShippingNoticeTemplatePickerData, loadShippingNoticeTemplates,
} from './shipping-notice-templates.server';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), range: vi.fn(), select: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

const row = (code: string, version: number, status: 'active' | 'draft', name = `${code} v${version}`) => ({
  id: `${code}-${version}`, code, version, name, shipping_notice: `${name} 배송`, return_exchange_notice: '반품',
  remote_area_notice: '제주 1~2일 추가', cs_name: 'CS', cs_phone: '02', cs_email: 'help@example.com', status,
});
const listed = (overrides: Record<string, unknown> = {}) => ({
  id: 'template-2', code: 'n-abc', version: 2, name: '기본 안내', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '',
  csName: 'CS', csPhone: '02', csEmail: '', status: 'active', updatedAt: '2026-11-26T01:00:00+00:00', goodsCount: 3, ...overrides,
});

beforeEach(() => {
  /* DB 조회 순서 그대로: 코드별, 버전이 큰 것부터. */
  mocks.range.mockReset().mockResolvedValue({ data: [
    row('basic', 3, 'draft', '기본(고치는 중)'), row('basic', 2, 'active', '나 기본'), row('basic', 1, 'active', '옛 기본'),
    row('figure', 1, 'active', '가 피규어'), row('pending', 1, 'draft', '준비 중'),
  ], error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { total: 1, rows: [listed()] }, error: null });
  const query = { select: mocks.select, order() { return this; }, range: mocks.range };
  mocks.select.mockReset().mockReturnValue(query);
  mocks.createClient.mockReset().mockResolvedValue({ from: () => query, rpc: mocks.rpc });
});

describe('상품등록 선택창의 배송 안내 템플릿', () => {
  /* 화면 규칙 2: 고치기 전 내용(예전 버전)과 아직 켜지 않은 템플릿은 조회에서 뺀다. */
  it('템플릿마다 지금 고를 수 있는 내용 하나만 이름순으로 돌려주고, 한 번도 켜지 않은 템플릿 수를 센다', async () => {
    const data = await loadShippingNoticeTemplatePickerData();
    expect(data.options.map((option) => `${option.code}@${option.version}`)).toEqual(['figure@1', 'basic@2']);
    expect(data.options[1]).toEqual({
      id: 'basic-2', code: 'basic', version: 2, name: '나 기본', shippingNotice: '나 기본 배송',
      returnExchangeNotice: '반품', remoteAreaNotice: '제주 1~2일 추가', csName: 'CS', csPhone: '02', csEmail: 'help@example.com',
    });
    expect(data.pendingCount).toBe(1);
    expect(mocks.range).toHaveBeenCalledWith(0, 999);
  });

  it('내부 확인 근거와 감사 칸은 읽지도 돌려주지도 않는다', async () => {
    const options = await loadActiveShippingNoticeTemplateOptions();
    expect(options).toHaveLength(2);
    const columns = String(mocks.select.mock.calls[0][0]);
    for (const column of ['confirmation_evidence', 'confirmed_by', 'confirmed_at']) expect(columns).not.toContain(column);
  });

  it('읽지 못하면 다음에 할 일을 말한다', async () => {
    mocks.range.mockResolvedValue({ data: null, error: { message: 'private' } });
    await expect(loadShippingNoticeTemplatePickerData()).rejects.toThrow('배송 안내 템플릿을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  });
});

describe('배송 안내 템플릿 목록', () => {
  it('목록 조회에 검색어와 20개씩의 자리를 보내고 줄을 그대로 읽는다', async () => {
    const data = await loadShippingNoticeTemplates({ query: '기본', page: 2 });
    /* 2쪽이 마지막 쪽보다 뒤라 마지막 쪽(1쪽)을 다시 읽는다. */
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_list_shipping_notice_templates', { p_query: '기본', p_limit: 20, p_offset: 20 }],
      ['admin_list_shipping_notice_templates', { p_query: '기본', p_limit: 20, p_offset: 0 }],
    ]);
    expect(data).toEqual({ total: 1, filters: { query: '기본', page: 1 }, templates: [{
      id: 'template-2', code: 'n-abc', version: 2, name: '기본 안내', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '',
      csName: 'CS', csPhone: '02', csEmail: '', status: 'active', updatedAt: '2026-11-26T01:00:00+00:00', goodsCount: 3,
    }] });
  });

  it('아직 켜지 않은 템플릿은 준비 중(draft)으로 읽고, 모양이 다른 응답은 받지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 1, rows: [listed({ status: 'draft', goodsCount: 0 })] }, error: null });
    expect((await loadShippingNoticeTemplates({ query: '', page: 1 })).templates[0]).toMatchObject({ status: 'draft', goodsCount: 0 });
    for (const data of [null, { total: 1 }, { total: 1, rows: [listed({ goodsCount: -1 })] }, { total: 1, rows: [listed({ updatedAt: null })] }]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(loadShippingNoticeTemplates({ query: '', page: 1 })).rejects.toThrow('배송 안내 템플릿을 불러오지 못했습니다.');
    }
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private' } });
    await expect(loadShippingNoticeTemplates({ query: '', page: 1 })).rejects.toThrow('잠시 뒤 새로고침해 주세요.');
  });

  it('템플릿 하나는 코드로 읽고, 없으면 null이다', async () => {
    expect(await loadShippingNoticeTemplate('n-abc')).toMatchObject({ id: 'template-2', goodsCount: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_shipping_notice_templates', { p_query: '', p_limit: 1, p_offset: 0, p_code: 'n-abc' });
    mocks.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
    expect(await loadShippingNoticeTemplate('n-none')).toBeNull();
  });
});
