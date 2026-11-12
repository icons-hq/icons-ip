import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStockDigestOriginAction, saveStockDigestOriginAction, saveStockSafetyDigestAction } from './stock-safety-digest-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const operationId = '70000000-0000-4000-8000-000000000001';
const originId = '70000000-0000-4000-8000-0000000000a1';
const origin = { originId, originCode: 'namyangju', originName: '남양주', active: true, revision: 1, recipients: ['seowon@example.test'] };
const settings = {
  revision: 3, enabled: true, sendTime: '09:00', operatorRecipients: ['ops@example.test'], enabledAt: '2031-05-01T00:00:00Z', updatedAt: '2031-05-01T00:00:00Z',
  updatedByName: '운영자', nextSendAt: '2031-05-02T00:00:00Z', lowStockCount: 2, origins: [origin], runs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'owner' } });
  mocks.rpc.mockResolvedValue({ data: settings, error: null });
});

describe('안전재고 요약 메일 설정 액션', () => {
  it('계정 주매니저(platform.manage) 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveStockSafetyDigestAction({ enabled: true, sendTime: '09:00', recipients: '', expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(await saveStockDigestOriginAction({ originId, recipients: '', expectedRevision: 0 })).toMatchObject({ ok: false });
    expect(await readStockDigestOriginAction(originId)).toMatchObject({ ok: false });
    expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/stock-reconcile', { capability: 'platform.manage' });
    expect(mocks.access).toHaveBeenCalledWith('/admin/settings/origins', { capability: 'platform.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('주소를 정리하고 요청 ID를 그대로 보내 저장한다', async () => {
    expect(await saveStockSafetyDigestAction({ enabled: true, sendTime: '09:00', recipients: ' Ops@Example.test\nops@example.test, md@example.test', expectedRevision: 2, operationId }))
      .toEqual({ ok: true, settings });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_stock_safety_digest', { p_enabled: true, p_send_time: '09:00',
      p_operator_recipients: ['ops@example.test', 'md@example.test'], p_expected_revision: 2, p_operation_id: operationId });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/stock-reconcile');
  });

  it('틀린 시각·주소·상한은 저장하지 않는다', async () => {
    for (const input of [
      { enabled: true, sendTime: '24:00', recipients: '', expectedRevision: 1 },
      { enabled: true, sendTime: '09:00', recipients: 'not-an-email', expectedRevision: 1 },
      { enabled: true, sendTime: '09:00', recipients: Array.from({ length: 11 }, (_, index) => `ops${index}@example.test`).join(','), expectedRevision: 1 },
      { enabled: true, sendTime: '09:00', recipients: '', expectedRevision: 0 },
    ]) expect(await saveStockSafetyDigestAction(input)).toMatchObject({ ok: false });
    expect(await saveStockDigestOriginAction({ originId, recipients: Array.from({ length: 6 }, (_, index) => `w${index}@example.test`).join('\n'), expectedRevision: 0 }))
      .toEqual({ ok: false, error: '받는 주소는 5개까지 넣을 수 있습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('충돌·권한 거절을 운영 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'stock_safety_digest_changed' } });
    expect(await saveStockSafetyDigestAction({ enabled: false, sendTime: '09:00', recipients: '', expectedRevision: 1 }))
      .toEqual({ ok: false, error: '다른 운영자가 먼저 설정을 바꿨습니다. 새로고침한 뒤 다시 저장해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await saveStockDigestOriginAction({ originId, recipients: 'seowon@example.test', expectedRevision: 0 }))
      .toEqual({ ok: false, error: '요약 메일 설정은 계정 주매니저 이상만 바꿀 수 있습니다.' });
  });

  it('출고지 담당자 주소를 읽고 저장한다(처음 저장의 기대 버전은 0)', async () => {
    expect(await readStockDigestOriginAction(originId)).toEqual({ ok: true, origin });
    expect(await readStockDigestOriginAction('other')).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValueOnce({ data: { ...origin, revision: 1 }, error: null });
    expect(await saveStockDigestOriginAction({ originId, recipients: 'Seowon@Example.test', expectedRevision: 0, operationId })).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_stock_safety_digest_origin', { p_origin_id: originId, p_recipients: ['seowon@example.test'],
      p_expected_revision: 0, p_operation_id: operationId });
  });
});
