import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneAdminGoodAction } from './good-clone-actions';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { throw error; },
}));

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  data.set('operationId', '00000000-0000-4000-8000-000000047901');
  data.set('sourceGoodId', 'source-good');
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true });
  mocks.rpc.mockReset().mockResolvedValue({ data: { id: 'copy-good', code: 'COPY-0001', sourceGoodId: 'source-good', operationId: '00000000-0000-4000-8000-000000047901' }, error: null });
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.revalidatePath.mockReset();
});

describe('cloneAdminGoodAction', () => {
  it('blocks malformed source and identities before RPC', async () => {
    const result = await cloneAdminGoodAction({}, form({ sourceGoodId: '../bad', newCode: 'bad code' }));
    expect(result.errors).toMatchObject({ sourceGoodId: expect.any(String), newCode: expect.any(String) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends one stable operation id and returns the new draft identity', async () => {
    const result = await cloneAdminGoodAction({}, form({ newId: 'copy-good', newCode: 'COPY-0001', newName: '복사본' }));
    expect(result).toMatchObject({ message: '초안 굿즈 COPY-0001를 만들었습니다.', savedGood: { id: 'copy-good' }, operationId: '00000000-0000-4000-8000-000000047901' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_clone_good', {
      target_operation_id: '00000000-0000-4000-8000-000000047901',
      target_source_good_id: 'source-good', target_new_id: 'copy-good', target_new_code: 'COPY-0001', target_new_name: '복사본',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/goods');
  });

  it('preserves the operation id and input when the source is archived or missing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'source_good_archived' } });
    const result = await cloneAdminGoodAction({}, form({ newName: '복사본' }));
    expect(result).toMatchObject({ operationId: '00000000-0000-4000-8000-000000047901', errors: { form: '보관된 굿즈는 복사할 수 없습니다.' }, values: { newName: '복사본' } });
  });
  it('preserves the same operation and input for retry after an overlapping checkout', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'goods_clone_source_busy' } });
    const result = await cloneAdminGoodAction({}, form({ newName: '복사본' }));
    expect(result).toMatchObject({ operationId: '00000000-0000-4000-8000-000000047901',
      errors: { form: expect.stringContaining('잠시 후 다시 복사') }, values: { newName: '복사본' } });
    expect(result.savedGood).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
