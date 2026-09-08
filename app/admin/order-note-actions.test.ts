import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addOrderNoteAction } from './order-note-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true },
  rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
const ORDER = '10000000-0000-4000-8000-000000004141';
const OPERATION = '50000000-0000-4000-8000-000000004141';
function form(body = '물류팀 확인 필요') {
  const data = new FormData();
  data.set('orderId', ORDER);
  data.set('operationId', OPERATION);
  data.set('body', body);
  return data;
}
beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.revalidatePath.mockReset();
});
describe('주문 운영자 메모', () => {
  it('동일 제출 키로 재시도한 메모도 성공으로 확인하고 정확한 주문 화면을 갱신한다', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await addOrderNoteAction({}, form());
    expect(result.message).toContain('저장했습니다');
    expect(result.resultKey).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_add_order_note', {
      target_order_id: ORDER, target_body: '물류팀 확인 필요', operation_id: OPERATION,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/sales/orders/${ORDER}`);
  });
  it('일반 회원의 메모 저장은 허용하지 않는다', async () => {
    mocks.auth.isStaff = false;
    expect((await addOrderNoteAction({}, form())).error).toContain('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('빈 메모와 2,000자 초과 메모는 입력 오류를 돌려준다', async () => {
    expect((await addOrderNoteAction({}, form('  '))).error).toContain('2,000자');
    expect((await addOrderNoteAction({}, form('가'.repeat(2001)))).error).toContain('2,000자');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('연결 오류와 DB 오류를 안전한 문구로 돌려주고 성공 신호를 내지 않는다', async () => {
    mocks.rpc.mockRejectedValue(new Error('private_connection_details'));
    const result = await addOrderNoteAction({}, form());
    expect(result.error).toContain('입력한 메모는 유지');
    expect(result.resultKey).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private_connection');
    mocks.rpc.mockResolvedValue({ error: { message: 'order_not_found' } });
    expect((await addOrderNoteAction({}, form())).error).toContain('주문을 찾을 수 없습니다');
  });
});
