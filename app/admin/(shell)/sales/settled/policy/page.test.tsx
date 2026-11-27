import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(async () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } })),
  policy: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  form: vi.fn((props: { initial: { autoEnabled: boolean } }) => <div data-policy-form={props.initial.autoEnabled ? 'on' : 'off'} />),
}));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));
vi.mock('@/lib/admin/purchase-confirmation-policy.server', () => ({ getPurchaseConfirmationPolicy: mocks.policy }));
vi.mock('@/components/admin/PurchaseConfirmationPolicyForm', () => ({ PurchaseConfirmationPolicyForm: mocks.form }));

import Page from './page';

const policy = { revision: 2, autoEnabled: true, autoAfterDays: 8, buyerExtensionDays: null, evidence: '', updatedAt: '2026-11-01T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); });

describe('거래확정 정책 화면', () => {
  it('주문 관리 권한으로 열고, 메뉴·목록과 같은 이름(거래확정)과 지금 상태를 보인다', async () => {
    mocks.policy.mockResolvedValue(policy);
    const html = renderToStaticMarkup(await Page());
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/settled/policy', { capability: 'sales.manage' });
    expect(html).toContain('거래확정 정책');
    expect(html).toContain('자동 거래확정 켜짐');
    expect(html).toContain('data-policy-form="on"');
    expect(html).toContain('href="/admin/sales/settled"');
    expect(html).not.toContain('구매확정');
    expect(html).not.toContain('활성');
    expect(mocks.form.mock.calls[0][0]).toMatchObject({ initial: policy, actorId: ACTOR, sessionId: null });

    mocks.policy.mockResolvedValue({ ...policy, autoEnabled: false });
    expect(renderToStaticMarkup(await Page())).toContain('자동 거래확정 꺼짐');
  });

  /* 전에는 오류 화면으로 던졌다. 머리와 목록으로 돌아갈 길을 남기고 그 자리에서 다음 할 일을 말한다. */
  it('정책을 읽지 못하면 화면 안에서 알리고 폼을 그리지 않는다', async () => {
    mocks.policy.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Page());
    expect(html).toMatch(/role="alert"[\s\S]*거래확정 정책을 불러오지 못했습니다\./);
    expect(html).toContain('새로고침해도 같으면 개발 담당자에게 알려주세요.');
    expect(html).toContain('href="/admin/sales/settled"');
    expect(mocks.form).not.toHaveBeenCalled();
  });
});
