const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPreorderScheduleChangeAction, listPreorderScheduleChangesAction, previewPreorderScheduleChangeAction, readPreorderScheduleChangeAction,
  retryPreorderScheduleEmailsAction,
} from './preorder-schedule-actions';
import { scheduleChange, scheduleIds, schedulePreview } from '@/lib/admin/preorder-schedule-change.fixture';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), dispatcher: vi.fn(), sms: vi.fn(), revalidate: vi.fn(), goods: vi.fn() }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.goods }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/email/dispatcher.server', () => ({ emailDispatcherFromEnvironment: mocks.dispatcher }));
vi.mock('@/lib/sms/notifications.server', () => ({ smsNotificationConfig: mocks.sms }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const applyInput = (overrides: Record<string, unknown> = {}) => ({
  requestId: scheduleIds.change.toUpperCase(), goodId: ' hsq-second ', variantId: null, expectedShipDate: '2026-12-09', reason: ' 공급처 입고 일정 변경 ',
  title: ' 예약 주문 발송 일정 변경 안내 ', body: ' 발송 예정일이 바뀌었습니다. ', fingerprint: '0123456789abcdef0123456789abcdef',
  excludedShipmentIds: [scheduleIds.shipment3, scheduleIds.shipment2, scheduleIds.shipment3], policyMode: null, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() });
  mocks.dispatcher.mockReturnValue({});
  mocks.sms.mockReturnValue(null);
});

describe('예약 일정 일괄 변경 서버 액션', () => {
  it('운영자가 아니면 미리보기·확정·결과·재시도 모두 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    expect(await previewPreorderScheduleChangeAction({ goodId: 'hsq-second', variantId: null, expectedShipDate: '2026-12-09' })).toMatchObject({ ok: false });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false });
    expect(await readPreorderScheduleChangeAction(scheduleIds.change)).toMatchObject({ ok: false });
    expect(await retryPreorderScheduleEmailsAction(scheduleIds.change)).toMatchObject({ ok: false });
    expect(await listPreorderScheduleChangesAction('hsq-second')).toMatchObject({ ok: false });
    /* 상품 관리만 가진 운영자(주문 관리 없음)도 주문 약속일·고객 안내는 바꾸지 못한다. */
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
    expect(await previewPreorderScheduleChangeAction({ goodId: 'hsq-second', variantId: null, expectedShipDate: '2026-12-09' })).toMatchObject({ ok: false });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('미리보기는 상품·옵션·날짜만 보내고 채널 준비 상태를 함께 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: json(schedulePreview()), error: null });
    mocks.sms.mockReturnValue({ sender: {}, advertisingOptOut: null });
    const result = await previewPreorderScheduleChangeAction({ goodId: ' hsq-second ', variantId: null, expectedShipDate: '2026-12-09' });
    expect(result).toMatchObject({ ok: true, emailConfigured: true, smsAvailable: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_goods_preorder_schedule_change', { p_good_id: 'hsq-second', p_variant_id: null, p_expected_ship_date: '2026-12-09' });
  });

  it.each([
    [{ goodId: '', variantId: null, expectedShipDate: '2026-12-09' }],
    [{ goodId: 'hsq-second', variantId: 'not-a-uuid', expectedShipDate: '2026-12-09' }],
    [{ goodId: 'hsq-second', variantId: null, expectedShipDate: '2026-02-30' }],
  ])('잘못된 미리보기 조건은 DB 전에 거절한다', async (input) => {
    expect(await previewPreorderScheduleChangeAction(input)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('다른 상품·날짜의 미리보기 응답은 확정 화면에 쓰지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: json(schedulePreview({ expectedShipDate: '2026-12-10' })), error: null });
    expect(await previewPreorderScheduleChangeAction({ goodId: 'hsq-second', variantId: null, expectedShipDate: '2026-12-09' })).toMatchObject({ ok: false });
  });

  it('확정은 정리한 입력과 미리보기 지문·제외 배송 건만 보내고, SMS 스위치가 꺼져 있으면 SMS를 요청하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: json(scheduleChange()), error: null });
    const result = await applyPreorderScheduleChangeAction(applyInput());
    expect(result).toMatchObject({ ok: true, change: { id: scheduleIds.change } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_apply_goods_preorder_schedule_change', {
      p_request_id: scheduleIds.change, p_good_id: 'hsq-second', p_variant_id: null, p_expected_ship_date: '2026-12-09', p_reason: '공급처 입고 일정 변경',
      p_customer_title: '예약 주문 발송 일정 변경 안내', p_customer_body: '발송 예정일이 바뀌었습니다.', p_preview_fingerprint: '0123456789abcdef0123456789abcdef',
      p_excluded_shipments: [scheduleIds.shipment2, scheduleIds.shipment3], p_sms_requested: false, p_policy_mode: null,
    });
    expect(mocks.goods).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/dispatch');
    mocks.sms.mockReturnValue({ sender: {}, advertisingOptOut: null });
    await applyPreorderScheduleChangeAction(applyInput());
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_sms_requested: true });
  });

  it.each([
    ['사유 없음', { reason: '  ' }],
    ['제목 줄바꿈', { title: '안내\n제목' }],
    ['본문 350자 초과', { body: '가'.repeat(351) }],
    ['지문 형식', { fingerprint: 'stale' }],
    ['요청 UUID 아님', { requestId: 'request' }],
    ['제외 배송 건 형식', { excludedShipmentIds: ['nope'] }],
    ['접수 중 조건 결정 값', { policyMode: 'both' }],
  ])('%s는 DB 전에 거절한다', async (_label, overrides) => {
    expect(await applyPreorderScheduleChangeAction(applyInput(overrides))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('이메일 설정이 없으면 일정도 바꾸지 않고, 이미 처리된 같은 요청이면 그 결과를 보인다', async () => {
    mocks.dispatcher.mockReturnValue(null);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'preorder_schedule_change_not_found' } });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false, error: expect.stringContaining('이메일 공급자') });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_read_goods_preorder_schedule_change']);
    mocks.rpc.mockResolvedValueOnce({ data: json(scheduleChange()), error: null });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('admin_apply_goods_preorder_schedule_change');
  });

  it('지문이 달라졌으면 다시 미리 보라고 알리고, 연결이 끊기면 결과 확인이 필요하다고 표시한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'preorder_schedule_stale' } });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false, stale: true, error: expect.stringContaining('다시 미리 본 뒤') });
    mocks.rpc.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false, uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: { id: scheduleIds.change }, error: null });
    expect(await applyPreorderScheduleChangeAction(applyInput())).toMatchObject({ ok: false, uncertain: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('접수 중 조건 교체는 활성화 권한(계정 주매니저·통합 매니저)만 고르고, 교체했으면 공개 상세도 새로 읽는다', async () => {
    expect(await applyPreorderScheduleChangeAction(applyInput({ policyMode: 'replace' }))).toMatchObject({ ok: false, error: expect.stringContaining('계정 주매니저') });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'primary' }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('primary') });
    mocks.rpc.mockResolvedValue({ data: json(scheduleChange({ policyAction: 'replaced', policies: [{ variantName: '기본 옵션', expectedShipDate: '2026-12-02' }] })), error: null });
    expect(await applyPreorderScheduleChangeAction(applyInput({ policyMode: 'replace' }))).toMatchObject({ ok: true, change: { policyAction: 'replaced' } });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_policy_mode: 'replace' });
    expect(mocks.goods).toHaveBeenCalledOnce();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'preorder_policy_changed' } });
    expect(await applyPreorderScheduleChangeAction(applyInput({ policyMode: 'acknowledge' }))).toMatchObject({ ok: false, stale: true });
  });

  it('실패한 이메일 재시도는 그 일정 변경의 안내 원장으로만 하고 결과를 다시 읽는다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_retry_order_delay_notice'
      ? { data: {}, error: null } : { data: json(scheduleChange()), error: null });
    expect(await retryPreorderScheduleEmailsAction(scheduleIds.change)).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls.map(([name, args]) => [name, args])).toEqual([
      ['admin_read_goods_preorder_schedule_change', { p_change_id: scheduleIds.change }],
      ['admin_retry_order_delay_notice', { target_notice: scheduleIds.notice }],
      ['admin_read_goods_preorder_schedule_change', { p_change_id: scheduleIds.change }],
    ]);
  });

  it('최근 기록 목록을 읽는다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await listPreorderScheduleChangesAction('hsq-second')).toEqual({ ok: true, changes: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_goods_preorder_schedule_changes', { p_good_id: 'hsq-second' });
  });
});
