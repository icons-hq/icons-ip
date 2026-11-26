const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteGoodsNoticePresetAction, saveGoodsNoticePresetAction } from './goods-notice-preset-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() },
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
    noticeAsManager: '엑스스퀘어 고객센터', noticeAsContact: '02-000-0000', ...overrides,
  })) data.set(key, value);
  return data;
}
beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: 'saved-preset', error: null });
  mocks.revalidatePath.mockReset();
});

describe('상품정보제공고시 템플릿 저장 액션', () => {
  it('KC 틀 누락과 명시적 삭제를 구분해 기존 7칸 클라이언트를 유지한다', async () => {
    await saveGoodsNoticePresetAction({}, form());
    expect(mocks.rpc.mock.calls[0][1].target_notice).not.toHaveProperty('kcTemplate');
    await saveGoodsNoticePresetAction({}, form({ kcTemplate: 'null' }));
    expect(mocks.rpc.mock.calls[1][1].target_notice).toHaveProperty('kcTemplate', null);
  });
  it('인증번호나 검토 상태가 섞인 KC 틀은 저장하지 않고 입력을 보존한다', async () => {
    const raw = JSON.stringify({ family: 'living', scheme: 'not_applicable', publicNote: '합성', identifier: 'COPIED' });
    const result = await saveGoodsNoticePresetAction({}, form({ kcTemplate: raw }));
    expect(result.errors?.kcTemplate).toBeTruthy();
    expect(result.values?.kcTemplate).toBe(raw);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('KC 포함 템플릿의 저장 충돌에도 새 안내 문구와 기존 고시값을 유지한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_notice_preset_conflict' } });
    const raw = JSON.stringify({ family: 'living', scheme: 'not_applicable', publicNote: '작성 중인 안내' });
    const result = await saveGoodsNoticePresetAction({}, form({ kcTemplate: raw }));
    /* 충돌 문구는 결과를 말한다: 새로고침하면 최신 내용이 보이고 지금 적은 내용은 사라진다. */
    expect(result.errors?.form).toBe('다른 사람이 먼저 바꿨습니다. 새로고침하면 최신 내용이 보입니다. 지금 적은 내용은 사라지니 필요한 칸은 먼저 복사해 두세요.');
    expect(result.values?.kcTemplate).toBe(raw);
    expect(result.values?.noticeMaterial).toBe('아크릴');
  });
  it('고시정보 7칸과 선택적인 KC 유형 틀을 함께 저장한다', async () => {
    const template={family:'living',scheme:'not_applicable',publicNote:'  합성 해당 없음 안내  '};
    const result=await saveGoodsNoticePresetAction({},form({kcTemplate:JSON.stringify(template)}));
    expect(result.message).toBe('‘아크릴 기본’ 템플릿을 등록했습니다.');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_notice_preset',expect.objectContaining({
      target_notice:expect.objectContaining({maker:'아이콘스',kcTemplate:{...template,publicNote:'합성 해당 없음 안내'}}),
    }));
  });
  it('고시 칸은 비워 둘 수 있다 — 비운 칸과 공백만 적은 칸은 빈 글로 저장한다', async () => {
    const result = await saveGoodsNoticePresetAction({}, form({ noticeSize: '', noticeMadeOn: '   ', noticeOrigin: '' }));
    expect(result.errors).toBeUndefined();
    expect(result.message).toBe('‘아크릴 기본’ 템플릿을 등록했습니다.');
    expect(mocks.rpc.mock.calls[0][1].target_notice).toEqual({
      maker: '아이콘스', origin: '', material: '아크릴', size: '', madeOn: '', asManager: '엑스스퀘어 고객센터', asContact: '02-000-0000',
    });
  });
  it('일곱 칸을 모두 비운 템플릿은 저장하지 않고 입력을 되돌려준다(KC 유형 틀만 있어도 같다)', async () => {
    const blank = { noticeMaker: '', noticeOrigin: ' ', noticeMaterial: '', noticeSize: '', noticeMadeOn: '', noticeAsManager: '', noticeAsContact: '' };
    const result = await saveGoodsNoticePresetAction({}, form(blank));
    expect(result.errors).toEqual({ form: '고시 내용을 한 칸 이상 적어 주세요. 일곱 칸이 모두 비어 있으면 상품에 가져올 내용이 없습니다.' });
    expect(result.values?.name).toBe('아크릴 기본');
    expect(result.attempt).toBe(1);
    expect(result.message).toBeUndefined();
    const kcOnly = await saveGoodsNoticePresetAction({}, form({ ...blank, kcTemplate: JSON.stringify({ family: 'living', scheme: 'not_applicable', publicNote: '' }) }));
    expect(kcOnly.errors?.form).toContain('한 칸 이상');
    expect(mocks.rpc).not.toHaveBeenCalled();
    /* 화면 검사를 지나친 요청도 DB가 같은 이유로 거절한다. */
    mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'goods_notice_preset_empty' } });
    expect((await saveGoodsNoticePresetAction({}, form())).errors?.form).toContain('한 칸 이상');
  });
  it('템플릿 이름은 꼭 적어야 하고, 칸은 1,000자까지다', async () => {
    const result = await saveGoodsNoticePresetAction({}, form({ name: '  ', noticeMaterial: '가'.repeat(1001) }));
    expect(result.errors?.name).toBe('템플릿 이름을 80자 안으로 적어 주세요.');
    expect(result.errors?.noticeMaterial).toBe('소재 칸은 1,000자까지 적을 수 있습니다.');
    expect(result.values?.noticeMaker).toBe('아이콘스');
    expect(result.values?.noticeAsContact).toBe('02-000-0000');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('저장 성공은 입력 복구 상태를 비우고 등록·수정을 이름과 함께 알린다', async () => {
    const result = await saveGoodsNoticePresetAction({ attempt: 2 }, form());
    expect(result.message).toBe('‘아크릴 기본’ 템플릿을 등록했습니다.');
    expect(result.values).toBeUndefined();
    expect(result.attempt).toBe(3);
    const updated = await saveGoodsNoticePresetAction({}, form({ id: '00000000-0000-4000-8000-000000042401', updatedAt: '2026-09-08T01:00:00Z', name: ' 키링 공통 ' }));
    expect(updated.message).toBe('‘키링 공통’ 템플릿을 저장했습니다.');
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
    expect(conflict.errors?.form).toContain('다른 사람이 먼저 바꿨습니다.');
    expect(Object.keys(conflict.values ?? {})).toHaveLength(10);
    expect(JSON.stringify(conflict)).not.toContain('private_database_detail');
    expect(JSON.stringify(conflict)).not.toContain('do-not-reflect');
    mocks.rpc.mockRejectedValue(new Error('connection_private_detail'));
    const failed = await saveGoodsNoticePresetAction({}, input);
    expect(failed.errors?.form).toContain('입력한 내용은 그대로 있습니다');
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
    expect(mocks.rpc).not.toHaveBeenCalled();
    input.set('confirmed', 'true');
    /* 채운 상품의 내용이 그대로 남는다는 말은 삭제 확인창에서 한 번만 한다. */
    expect((await deleteGoodsNoticePresetAction({}, input)).message).toBe('템플릿을 삭제했습니다.');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delete_goods_notice_preset', { target_id: '00000000-0000-4000-8000-000000042401', expected_updated_at: '2026-09-08T01:00:00Z' });
    input.set('updatedAt', '');
    expect((await deleteGoodsNoticePresetAction({}, input)).errors?.form).toContain('최신');
  });
  it('다른 사람이 먼저 바꾼 템플릿은 삭제하지 않고 다음에 할 일을 알린다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_notice_preset_conflict' } });
    const input = form({ id: '00000000-0000-4000-8000-000000042401', updatedAt: '2026-09-08T01:00:00Z', confirmed: 'true' });
    expect((await deleteGoodsNoticePresetAction({}, input)).errors?.form).toBe('다른 사람이 먼저 바꿨습니다. 새로고침해 최신 내용을 확인한 뒤 다시 삭제해 주세요.');
  });
});
