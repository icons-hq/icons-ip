import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteGoodsNoticePresetAction, saveGoodsNoticePresetAction } from './goods-notice-preset-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true },
  rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: '', updatedAt: '', name: '아크릴 기본', noticeMaker: '아이콘스', noticeOrigin: '대한민국',
    noticeMaterial: '아크릴', noticeSize: '80mm', noticeMadeOn: '2026-09',
    noticeAsManager: '아이콘스 고객센터', noticeAsContact: '02-000-0000', ...overrides,
  })) data.set(key, value);
  return data;
}
beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: 'saved-preset', error: null });
  mocks.revalidatePath.mockReset();
});

describe('상품정보제공고시 프리셋 저장 액션', () => {
  it('필수 항목을 빠뜨리면 해당 필드 오류와 입력값을 되돌려준다', async () => {
    const result = await saveGoodsNoticePresetAction({}, form({ noticeOrigin: '' }));
    expect(result.errors?.noticeOrigin).toContain('원산지');
    expect(result.values?.noticeMaker).toBe('아이콘스');
    expect(result.values?.noticeAsContact).toBe('02-000-0000');
    expect(result.attempt).toBe(1);
    expect(result.message).toBeUndefined();
  });
  it('저장 성공은 입력 복구 상태를 비우고 사용자에게 완료를 알린다', async () => {
    const result = await saveGoodsNoticePresetAction({ attempt: 2 }, form());
    expect(result.message).toContain('저장했습니다');
    expect(result.values).toBeUndefined();
    expect(result.attempt).toBe(3);
  });
  it('일반 회원은 저장과 삭제 모두 권한 오류를 받는다', async () => {
    mocks.auth.isStaff = false;
    expect((await saveGoodsNoticePresetAction({}, form())).errors?.form).toContain('권한');
    expect((await deleteGoodsNoticePresetAction({}, form())).errors?.form).toContain('권한');
  });
  it('RPC 실패와 연결 오류에도 7칸을 유지하고 내부 오류는 반환하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_notice_preset_conflict private_database_detail' } });
    const input = form({ unexpectedPrivateValue: 'do-not-reflect' });
    const conflict = await saveGoodsNoticePresetAction({}, input);
    expect(conflict.errors?.form).toContain('다른 운영자');
    expect(Object.keys(conflict.values ?? {})).toHaveLength(10);
    expect(JSON.stringify(conflict)).not.toContain('private_database_detail');
    expect(JSON.stringify(conflict)).not.toContain('do-not-reflect');
    mocks.rpc.mockRejectedValue(new Error('connection_private_detail'));
    const failed = await saveGoodsNoticePresetAction({}, input);
    expect(failed.errors?.form).toContain('입력값은 유지');
    expect(failed.values?.noticeMaterial).toBe('아크릴');
    expect(failed.values?.noticeMadeOn).toBe('2026-09');
    expect(failed.message).toBeUndefined();
  });
  it('이미 쓰는 이름은 이름 필드에서 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '23505', message: 'unique violation' } });
    expect((await saveGoodsNoticePresetAction({}, form())).errors?.name).toContain('이미 사용');
  });
  it('삭제 확인과 최신 버전이 있어야 삭제할 수 있다', async () => {
    const input = form({ id: '00000000-0000-4000-8000-000000042401', updatedAt: '2026-09-08T01:00:00Z' });
    expect((await deleteGoodsNoticePresetAction({}, input)).errors?.form).toContain('삭제 확인');
    input.set('confirmed', 'true');
    expect((await deleteGoodsNoticePresetAction({}, input)).message).toContain('삭제했습니다');
    input.set('updatedAt', '');
    expect((await deleteGoodsNoticePresetAction({}, input)).errors?.form).toContain('최신');
  });
});
