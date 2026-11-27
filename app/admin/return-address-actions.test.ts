import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'admin' }, isStaff: true, role: 'admin' }, rpc: vi.fn(), count: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => ({ ...mocks.auth, operatorAccess: legacyOperatorAccessFixture(mocks.auth.role as 'admin' | 'staff') }) }));
/* `from('goods')`는 저장 직후 이 반품/교환지를 고른 상품 수를 읽는다(select → eq → 결과). */
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: mocks.count }) }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('redirect:')) throw error; }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { deleteReturnAddressAction, saveReturnAddressAction } from './return-address-actions';

const ID = '00000000-0000-4000-8000-000000000001';
const STAMP = '2026-11-26T01:00:00.000001Z';
function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678', ...fields })) data.set(key, value);
  return data;
}
const edit = (fields: Record<string, string> = {}) => form({ id: ID, updatedAt: STAMP, ...fields });

beforeEach(() => {
  mocks.auth.role = 'admin';
  mocks.rpc.mockReset().mockResolvedValue({ data: { id: ID, updatedAt: '2026-11-26T02:00:00.000001Z' }, error: null });
  mocks.count.mockReset().mockResolvedValue({ count: 3, error: null });
  mocks.revalidatePath.mockClear();
});

describe('반품/교환지 저장', () => {
  it('최고 관리자만 저장한다 — 거절은 DB를 부르기 전이다', async () => {
    mocks.auth.role = 'staff';
    expect((await saveReturnAddressAction({}, edit())).errors?.form).toBe('반품/교환지 변경은 최고 관리자만 할 수 있습니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('등록하면 상품에서 고를 수 있다고 알린다', async () => {
    const result = await saveReturnAddressAction({}, form());
    expect(result.message).toBe('반품/교환지를 등록했습니다. 상품의 반품·교환에서 고를 수 있습니다.');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_return_address', { p_id: null, p_values: { name: '서울 센터', address: '서울시 중구 1', phone: '02-1234-5678' }, p_expected_updated_at: null });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(result.updatedAt).toBeUndefined();
  });
  it('주소를 고치면 이 반품/교환지를 고른 상품 수와 함께 바로 보인다고 알리고 새 저장 시각을 돌려준다', async () => {
    const result = await saveReturnAddressAction({}, edit({ address: '서울시 중구 2' }));
    expect(result.message).toBe('저장했습니다. 이 반품/교환지를 고른 상품 3개의 상세 화면에 바로 보입니다.');
    expect(result.updatedAt).toBe('2026-11-26T02:00:00.000001Z');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_return_address', expect.objectContaining({ p_id: ID, p_expected_updated_at: STAMP }));
    expect(mocks.count).toHaveBeenCalledWith('return_address_id', ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/return-addresses');
  });
  it('고른 상품이 없으면 그렇게 말하고, 수를 읽지 못해도 저장은 끝났다고 말한다', async () => {
    mocks.count.mockResolvedValue({ count: 0, error: null });
    expect((await saveReturnAddressAction({}, edit())).message).toBe('저장했습니다. 이 반품/교환지를 고른 상품은 아직 없습니다.');
    mocks.count.mockResolvedValue({ count: null, error: { message: 'x' } });
    expect((await saveReturnAddressAction({}, edit())).message).toBe('저장했습니다. 이 반품/교환지를 고른 상품의 상세 화면에 바로 보입니다.');
    mocks.count.mockRejectedValue(new Error('down'));
    const result = await saveReturnAddressAction({}, edit());
    expect(result.message).toBe('저장했습니다. 이 반품/교환지를 고른 상품의 상세 화면에 바로 보입니다.');
    expect(result.errors).toBeUndefined();
  });
  it('입력이 틀리면 칸마다 고칠 방법을 말하고 DB를 부르지 않는다 — 입력은 그대로 돌려준다', async () => {
    const result = await saveReturnAddressAction({}, form({ name: '', phone: 'abc' }));
    expect(result.errors).toEqual({ name: '반품/교환지 이름을 60자 이내로 입력해 주세요.', phone: '연락처는 숫자와 하이픈(-)으로 입력해 주세요. 예: 02-1234-5678' });
    expect(result.values).toMatchObject({ address: '서울시 중구 1', phone: 'abc' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('수정인데 번호나 저장 시각이 맞지 않으면 낡은 화면 안내로 거절한다', async () => {
    expect((await saveReturnAddressAction({}, edit({ updatedAt: '' }))).errors?.form).toBe('화면 정보가 오래됐습니다. 새로고침한 뒤 다시 해 주세요.');
    expect((await saveReturnAddressAction({}, edit({ id: 'not-a-uuid' }))).errors?.form).toBe('화면 정보가 오래됐습니다. 새로고침한 뒤 다시 해 주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('다른 사람이 먼저 바꿨으면 낱말 표의 말로 알리고 입력을 남긴다 — 상품 수를 읽지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'return_address_conflict' } });
    const result = await saveReturnAddressAction({}, edit());
    expect(result.errors?.form).toBe('다른 사람이 먼저 바꿨습니다. 입력한 내용을 복사해 둔 뒤 새로고침해 최신 내용을 확인해 주세요.');
    expect(result.values).toMatchObject({ name: '서울 센터' });
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it('같은 이름이 있으면 다른 이름으로 저장하라고 말한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'return_address_name_taken' } });
    expect((await saveReturnAddressAction({}, form())).errors?.form).toBe('같은 이름의 반품/교환지가 이미 있습니다. 다른 이름으로 저장해 주세요.');
  });
  it('통신이 끊기면 입력이 남아 있다고 말한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('network detail'));
    const result = await saveReturnAddressAction({}, edit());
    expect(result.errors?.form).toBe('반품/교환지를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 뒤 다시 해 주세요.');
    expect(JSON.stringify(result)).not.toContain('network detail');
  });
});

describe('반품/교환지 삭제', () => {
  const remove = (fields: Record<string, string> = {}) => { const data = new FormData(); data.set('id', ID); data.set('updatedAt', STAMP); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
  it('지우면 지웠다고 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await deleteReturnAddressAction({}, remove())).toMatchObject({ message: '반품/교환지를 지웠습니다.', deleted: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delete_return_address', { p_id: ID, p_expected_updated_at: STAMP });
  });
  it('상품이 고른 반품/교환지는 DB가 거절하고, 어느 상품을 먼저 바꿀지 말한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'return_address_in_use' } });
    expect((await deleteReturnAddressAction({}, remove())).errors?.form).toBe('이 반품/교환지를 고른 상품이 있어 지울 수 없습니다. 그 상품의 반품/교환지를 먼저 바꿔 주세요.');
  });
  it('알 수 없는 오류는 지우지 못했다고 말한다(저장이라 말하지 않는다)', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: { message: 'boom' } });
    expect((await deleteReturnAddressAction({}, remove())).errors?.form).toBe('반품/교환지를 지우지 못했습니다. 잠시 뒤 다시 해 주세요.');
    mocks.rpc.mockRejectedValue(new Error('down'));
    expect((await deleteReturnAddressAction({}, remove())).errors?.form).toBe('반품/교환지를 지우지 못했습니다. 잠시 뒤 다시 해 주세요.');
  });
  it('권한이 없거나 번호·저장 시각이 맞지 않으면 DB를 부르지 않는다', async () => {
    expect((await deleteReturnAddressAction({}, remove({ updatedAt: '' }))).errors?.form).toBe('화면 정보가 오래됐습니다. 새로고침한 뒤 다시 해 주세요.');
    mocks.auth.role = 'staff';
    expect((await deleteReturnAddressAction({}, remove())).errors?.form).toBe('반품/교환지 변경은 최고 관리자만 할 수 있습니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
