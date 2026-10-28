const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readGoodsOptionSaleModeAction, setGoodsOptionSaleModeAction } from './goods-option-sale-mode-actions';

const GOOD_ID = 'random-photocard';
const UPDATED_AT = '2026-10-28T01:00:00.000+00:00';
const STATE = { goodId: GOOD_ID, optionSaleMode: 'random', updatedAt: '2026-10-28T01:05:00+00:00', randomProblem: null, activeOptionCount: 3 };

const mocks = vi.hoisted(() => ({
  adminState: {} as Record<string, unknown>,
  createClient: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

function form(values: Record<string, string | null> = {}) {
  const data = new FormData();
  const merged = { id: GOOD_ID, mode: 'random', expectedUpdatedAt: UPDATED_AT, ...values };
  for (const [key, value] of Object.entries(merged)) if (value !== null) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.test' }, role: 'staff', isStaff: true,
    operatorAccess: legacyOperatorAccessFixture(),
  };
  mocks.getCurrentAdminAuthState.mockReset();
  mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.adminState);
  mocks.createClient.mockReset();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.revalidatePath.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (fn: string) => fn === 'admin_goods_option_sale_mode'
    ? { data: STATE, error: null }
    : { data: { goodId: GOOD_ID, optionSaleMode: 'random', updatedAt: STATE.updatedAt, ipId: 'ip-1' }, error: null });
});

describe('setGoodsOptionSaleModeAction', () => {
  it('감사 setter를 낙관 잠금 값과 함께 부르고, 바뀐 상태와 판매 표면 갱신을 돌려준다', async () => {
    const result = await setGoodsOptionSaleModeAction({}, form());
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_set_goods_option_sale_mode', {
      p_good_id: GOOD_ID, p_mode: 'random', p_expected_updated_at: UPDATED_AT,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_goods_option_sale_mode', { p_good_id: GOOD_ID });
    expect(result).toEqual({ message: expect.stringContaining('랜덤 판매'), state: STATE });
    expect(mocks.revalidatePath.mock.calls).toEqual(expect.arrayContaining([['/shop'], ['/cart'], ['/checkout'], ['/shop/[goodId]', 'page']]));
  });

  it.each([
    ['판매 방식이 없음', { mode: null }],
    ['모르는 판매 방식', { mode: 'lucky' }],
    ['상품 id 공백', { id: '  ' }],
    ['낙관 잠금 값 없음', { expectedUpdatedAt: null }],
    ['낙관 잠금 값이 시각이 아님', { expectedUpdatedAt: 'yesterday' }],
  ] as const)('%s이면 RPC에 닿기 전에 막는다', async (_label, values) => {
    const result = await setGoodsOptionSaleModeAction({}, form(values));
    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('DB 랜덤 조건 거절을 운영자 문구로 옮기고 표면은 갱신하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'random_option_price_mismatch' } });
    const result = await setGoodsOptionSaleModeAction({}, form());
    expect(result.error).toContain('판매가');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'goods_changed' } });
    expect((await setGoodsOptionSaleModeAction({}, form())).error).toContain('다른 곳에서');
  });

  it('로그인한 비스태프는 RPC에 닿기 전에 막는다', async () => {
    mocks.adminState = { isConfigured: true, user: { id: 'fan-1', email: null }, role: 'user', isStaff: false };
    expect(await setGoodsOptionSaleModeAction({}, form())).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('readGoodsOptionSaleModeAction', () => {
  it('조회 RPC 응답을 검증해 돌려준다', async () => {
    expect(await readGoodsOptionSaleModeAction(GOOD_ID)).toEqual({ state: STATE });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_goods_option_sale_mode', { p_good_id: GOOD_ID });
  });

  it('모양이 다른 응답·오류는 상태 없이 문구만 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...STATE, optionSaleMode: 'lucky' }, error: null });
    expect(await readGoodsOptionSaleModeAction(GOOD_ID)).toEqual({ error: '판매 방식을 불러오지 못했습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'operator_capability_required' } });
    expect((await readGoodsOptionSaleModeAction(GOOD_ID)).error).toContain('권한');
    expect(await readGoodsOptionSaleModeAction('  ')).toEqual({ error: '상품을 찾지 못했습니다.' });
  });
});
