import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveOpsAlertDigestAction } from './ops-alert-digest-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const operationId = '80000000-0000-4000-8000-000000000001';
const settings = { revision: 3, enabled: true, recipients: ['cs@example.test'], categories: ['inquiries', 'system'], delayHours: 4,
  enabledAt: '2031-05-01T00:00:00Z', updatedAt: '2031-05-01T00:00:00Z', updatedByName: '운영자', runs: [] };
const input = { enabled: true, recipients: ' CS@Example.test\ncs@example.test', categories: ['system', 'inquiries'], delayHours: 4, expectedRevision: 2, operationId };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'owner' } });
  mocks.rpc.mockResolvedValue({ data: settings, error: null });
});

describe('운영 알림 요약 메일 설정 액션', () => {
  it('계정 주매니저(platform.manage) 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveOpsAlertDigestAction(input)).toMatchObject({ ok: false });
    expect(mocks.access).toHaveBeenCalledWith('/admin/settings/system', { capability: 'platform.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('주소·범주를 정리하고 요청 ID를 그대로 보내 저장한다', async () => {
    expect(await saveOpsAlertDigestAction(input)).toEqual({ ok: true, settings: expect.objectContaining({ revision: 3 }) });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_ops_alert_digest', { p_enabled: true, p_recipients: ['cs@example.test'],
      p_categories: ['inquiries', 'system'], p_delay_hours: 4, p_expected_revision: 2, p_operation_id: operationId });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/settings/system');
  });

  it('범주가 비었거나 모르는 값이 있으면, 지연 시간이 범위 밖이면 DB에 닿지 않는다', async () => {
    for (const bad of [{ categories: [] }, { categories: ['inquiries', 'orders'] }, { delayHours: 0 }, { delayHours: 73 }, { recipients: 'nope' }, { expectedRevision: 0 }]) {
      expect(await saveOpsAlertDigestAction({ ...input, ...bad })).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB 오류는 운영자 말로 옮기고 결과 모양이 틀리면 확인을 부른다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'ops_alert_digest_changed' } });
    expect(await saveOpsAlertDigestAction(input)).toEqual({ ok: false, error: expect.stringContaining('다른 운영자가 먼저') });
    mocks.rpc.mockResolvedValue({ data: { nope: 1 }, error: null });
    expect(await saveOpsAlertDigestAction(input)).toEqual({ ok: false, error: expect.stringContaining('새로고침') });
  });
});
