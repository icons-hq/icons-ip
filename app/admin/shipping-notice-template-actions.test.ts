import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateShippingNoticeTemplateAction,
  applyShippingNoticeTemplateAction,
  saveShippingNoticeTemplateAction,
} from './shipping-notice-template-actions';

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
    id: '', updatedAt: '', code: 'basic-v2', version: '2', name: '기본 배송 안내',
    shippingNotice: '배송 안내', returnExchangeNotice: '교환·반품 안내', csName: '아이콘스 CS',
    csPhone: '02-000-0000', csEmail: 'help@example.com', confirmationEvidence: '운영 자료 확인',
    templateId: '00000000-0000-4000-8000-000000049001', goodId: 'good-1',
    goodUpdatedAt: '2026-09-10T01:00:00Z', ...overrides,
  })) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: { updatedAt: '2026-09-10T02:00:00Z' }, error: null });
  mocks.revalidatePath.mockReset();
});

describe('배송정보 템플릿 액션', () => {
  it('초안을 저장하고 입력 검증 오류 때 값을 되돌려준다', async () => {
    const result = await saveShippingNoticeTemplateAction({}, form({ name: '' }));
    expect(result.errors?.name).toContain('입력');
    expect(result.values?.shippingNotice).toBe('배송 안내');
    expect(mocks.rpc).not.toHaveBeenCalled();
    const success = await saveShippingNoticeTemplateAction({}, form());
    expect(success.message).toContain('저장했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_notice_template', expect.objectContaining({ target_version: 2 }));
    expect(success.updatedAt).toBe('2026-09-10T02:00:00Z');
  });

  it('확인 근거가 있어야 활성화하고 상품 적용은 최신 시각을 함께 보낸다', async () => {
    const activation = await activateShippingNoticeTemplateAction({}, form({ id: '00000000-0000-4000-8000-000000049001', updatedAt: '2026-09-10T01:00:00Z' }));
    expect(activation.message).toContain('활성화했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_activate_shipping_notice_template', expect.objectContaining({ evidence: '운영 자료 확인' }));
    const applied = await applyShippingNoticeTemplateAction({}, form());
    expect(applied.message).toContain('적용했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_apply_shipping_notice_template', expect.objectContaining({
      target_good_id: 'good-1', expected_good_updated_at: '2026-09-10T01:00:00Z',
    }));
  });

  it('다중 줄 고객 안내와 확인 근거를 허용하고 명시적 해제는 null 템플릿으로 보낸다', async () => {
    const multiline = form({ id: '00000000-0000-4000-8000-000000049001', updatedAt: '2026-09-10T01:00:00Z', shippingNotice: '첫 줄\n둘째 줄\t탭', returnExchangeNotice: '반품\r\n안내', confirmationEvidence: '문서\n대조' });
    expect((await saveShippingNoticeTemplateAction({}, multiline)).message).toContain('저장했습니다');
    expect((await activateShippingNoticeTemplateAction({}, multiline)).message).toContain('활성화했습니다');
    const cleared = await applyShippingNoticeTemplateAction({}, form({ templateId: '', clear: 'true' }));
    expect(cleared.message).toContain('적용했습니다');
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_apply_shipping_notice_template', expect.objectContaining({ target_template_id: null }));
  });

  it('일반 회원과 충돌 오류는 권한·입력 유지 메시지로 변환한다', async () => {
    mocks.auth.isStaff = false;
    expect((await saveShippingNoticeTemplateAction({}, form())).errors?.form).toContain('권한');
    mocks.auth.isStaff = true;
    mocks.rpc.mockResolvedValue({ error: { message: 'good_shipping_notice_conflict private' } });
    const result = await applyShippingNoticeTemplateAction({}, form());
    expect(result.errors?.form).toContain('다른 운영자');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
