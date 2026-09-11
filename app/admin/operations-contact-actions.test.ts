import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'admin' }, isStaff: true, role: 'admin' },
  rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('redirect:')) throw error; },
}));
import { saveOperationsContactAction } from './operations-contact-actions';

const stamp = '2026-09-11T03:00:00.123456+00:00';
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ scope: 'operations', originId: '', updatedAt: '', ownerName: ' 운영 담당 ', contact: 'ops@example.test', sourceReference: '사내 자료/계약', handoffReference: '', ...overrides })) data.set(key, value);
  return data;
}
beforeEach(() => {
  Object.assign(mocks.auth, { isConfigured: true, isStaff: true, role: 'admin' });
  mocks.rpc.mockReset().mockResolvedValue({ data: stamp, error: null });
  mocks.revalidatePath.mockClear();
});

describe('운영 담당자 저장 경계', () => {
  it.each([{ role: 'staff', isStaff: true }, { role: 'admin', isStaff: false }])('비관리자 및 정지된 관리자의 DB 호출을 막는다: %j', async auth => {
    Object.assign(mocks.auth, auth);
    const result = await saveOperationsContactAction({}, form());
    expect(result.errors?.form).toContain('관리자');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('최초 저장은 null 버전과 정규화한 값만 보내며 해당 화면만 갱신한다', async () => {
    expect(await saveOperationsContactAction({}, form())).toEqual({ message: '담당자 정보를 저장했습니다.', updatedAt: stamp });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_operations_contact', {
      target_scope: 'operations', target_origin_id: null, expected_updated_at: null,
      target_values: { ownerName: '운영 담당', contact: 'ops@example.test', sourceReference: '사내 자료/계약', handoffReference: '' },
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin/settings/operations']]);
  });
  it('기존 출고지 저장의 마이크로초 버전을 그대로 전달한다', async () => {
    const originId = '00000000-0000-4000-8000-000000499001';
    await saveOperationsContactAction({}, form({ scope: 'origin', originId, updatedAt: stamp }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_operations_contact', expect.objectContaining({ target_origin_id: originId, expected_updated_at: stamp }));
  });
  it.each<Record<string, string>>([
    { scope: 'other' }, { scope: 'operations', originId: '00000000-0000-4000-8000-000000499001' },
    { scope: 'origin' }, { updatedAt: 'yesterday' }, { ownerName: 'a'.repeat(101) }, { contact: 'ops\n@example.test' },
  ])('잘못된 입력을 DB 호출 전에 거부한다: %j', async values => {
    expect((await saveOperationsContactAction({}, form(values))).errors).toBeDefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('중복 입력과 파일 입력을 빈 값으로 대체하지 않는다', async () => {
    const duplicate = form(); duplicate.append('contact', 'second@example.test');
    expect((await saveOperationsContactAction({}, duplicate)).errors?.form).toBeDefined();
    const file = form(); file.set('contact', new File(['contents'], 'contact.txt'));
    expect((await saveOperationsContactAction({}, file)).errors?.form).toBeDefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('충돌 후에도 성공했던 버전을 보존하고 내부 오류 내용을 노출하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'operations_contact_changed private_raw_contact' } });
    const result = await saveOperationsContactAction({ updatedAt: stamp }, form({ updatedAt: stamp }));
    expect(result.errors?.form).toContain('다른 관리자');
    expect(result.updatedAt).toBe(stamp);
    expect(JSON.stringify(result)).not.toContain('private_raw_contact');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('RPC 예외를 안내로 바꾸고 화면 갱신을 하지 않는다', async () => {
    mocks.rpc.mockRejectedValue(new Error('private_raw_contact'));
    const result = await saveOperationsContactAction({}, form());
    expect(result.errors?.form).toContain('입력값은 유지');
    expect(JSON.stringify(result)).not.toContain('private_raw_contact');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('로그인 이동을 일반 저장 실패로 삼키지 않는다', async () => {
    mocks.auth.isConfigured = false;
    await expect(saveOperationsContactAction({}, form())).rejects.toThrow('redirect:/login?next=%2Fadmin%2Fsettings%2Foperations');
  });
});
