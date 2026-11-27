import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } }) }));
vi.mock('@/app/orders/purchase-confirmation-actions', () => ({ readPurchaseConfirmationAction: mocks.read, changePurchaseConfirmationAction: mocks.change }));
import { PurchaseConfirmationPanel } from './PurchaseConfirmationPanel';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import type { PurchaseConfirmation } from '@/lib/purchase-confirmation';

/*
 * 고객 주문 화면과 어드민 주문 상세가 함께 쓰는 부품. 고객 쪽 글자·동작은 그대로이고(구매확정), 어드민 쪽만 '거래확정'과 확인창을 쓴다.
 * 이 시험은 React 훅을 번호로 되돌려 주는 방식이라 useState 호출 순서가 곧 번호다.
 */
const ORDER = '10000000-0000-4000-8000-000000004141';
const IDENTITY = { actorId: 'actor-1', sessionId: 'session-1' };
const STATE = { value: 0, identity: 1, message: 2, blocked: 3, pending: 4, uncertain: 5, ack: 6 } as const;
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; onClick?: () => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
const confirmation = (over: Partial<PurchaseConfirmation> = {}): PurchaseConfirmation => ({ orderId: ORDER, revision: 3, status: 'delivered', confirmedAt: null, confirmationKind: null,
  autoDueAt: '2026-12-01T00:00:00Z', automaticActive: true, held: false, holdReason: null, extensionUsed: false, extensionDays: 3, requestedAt: null, canConfirm: true, canExtend: true, history: [], ...over });
function mount(value: PurchaseConfirmation | null, extra: Partial<Record<keyof typeof STATE, unknown>> = {}) {
  hooks.state = []; hooks.refs = [{ current: true }, { current: IDENTITY }, { current: false }];
  hooks.state[STATE.value] = value; hooks.state[STATE.identity] = IDENTITY;
  for (const [key, entry] of Object.entries(extra)) hooks.state[STATE[key as keyof typeof STATE]] = entry;
}
/* 어드민 상세는 확인창이 어느 주문인지 말하도록 주문번호를 넘긴다. 고객 화면은 넘기지 않는다. */
const ORDER_NUMBER = '20261126140010000034';
function render(admin: boolean, orderNumber: string | undefined = admin ? ORDER_NUMBER : undefined) { hooks.index = 0; hooks.refIndex = 0; return PurchaseConfirmationPanel({ orderId: ORDER, orderNumber, actorId: IDENTITY.actorId, admin }) as Element; }
const buttons = (admin: boolean) => all(render(admin)).filter(e => e.type === 'button').map(e => text(e));
async function settle() { for (let n = 0; n < 24; n++) await Promise.resolve(); }
async function click(admin: boolean, label: string) {
  const button = all(render(admin)).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label);
  button.props.onClick?.(); await settle();
}
/* 확인창 호스트 대신 요청을 모으고 운영자의 답을 정한다. 글을 받는 확인창(adminPrompt)이면 reply를 입력으로 넘긴다. */
const requests: AdminConfirmRequest[] = []; let answer = true; let reply = ''; let restore = () => {};
beforeEach(() => {
  vi.resetAllMocks(); requests.length = 0; answer = true; reply = '';
  restore = setAdminConfirmHandler(async request => { requests.push(request); if (answer) request.receive?.(reply); return answer; });
});
afterEach(() => restore());

describe('고객 주문 화면(admin 아님) — 글자와 동작이 그대로다', () => {
  it('구매확정 이름·안내·확인 체크·버튼·이력 이름을 그대로 쓴다', () => {
    mount(confirmation({ automaticActive: false, history: [{ id: '10000000-0000-4000-8000-000000000001', kind: 'hold', note: '사진 확인', at: '2026-11-26T01:00:00Z' }] }));
    const html = text(render(false));
    for (const line of ['구매확정', '구매확정 시 주문 당시 정책에 따라 적립금을 지급합니다. 구매확정 이후에도 반품·교환은 별도 신청 자격과 기한을 적용합니다.',
      '확정 상태', '미확정', '자동 확정 꺼짐 또는 적용 대상 아님', '받은 상품과 구매확정·기간 연장 내용을 확인했습니다.', '구매확정 3일 연장 (1회)',
      '구매확정 이력 (1)', '구매확정 보류 · 사진 확인']) expect(html, line).toContain(line);
    expect(html).not.toContain('거래확정');
    expect(buttons(false)).toEqual(['구매확정', '구매확정 3일 연장 (1회)', '구매확정 상태 다시 불러오기']);
  });
  it('확정된 주문은 중간점 뒤를 붙여 쓰고(옛 표기 그대로) 요청 알림은 인앱 알림으로 적는다', () => {
    mount(confirmation({ status: 'done', confirmationKind: 'buyer', confirmedAt: '2026-11-26T01:00:00Z', requestedAt: '2026-11-25T01:00:00Z' }));
    const html = text(render(false));
    expect(html).toContain('구매자 직접 확정 ·2026. 11. 26. 10:00'); expect(html).toContain('구매확정 요청'); expect(html).toContain('인앱 알림');
    mount(confirmation({ status: 'done', confirmationKind: null, confirmedAt: null }));
    expect(text(render(false))).toContain('구매 확정 ·시각 미기록');
  });
  it('로그인이 바뀌면 옛 문구로 알리고, 확인 체크 뒤 구매확정은 서버 액션 실패 때 옛 문구를 쓴다', async () => {
    mount(null, { blocked: true });
    expect(text(render(false))).toBe('로그인 계정 또는 세션이 바뀌었습니다. 주문 화면을 다시 열어주세요.');
    mount(confirmation(), { ack: true });
    mocks.change.mockRejectedValue(new Error('lost'));
    await click(false, '구매확정');
    expect(mocks.change).toHaveBeenCalledWith(ORDER, 'confirm', '', 3, expect.any(String), IDENTITY, false, true);
    expect(text(render(false))).toContain('결과가 불명확합니다. 현재 상태를 다시 불러와주세요.');
    mount(confirmation(), { ack: true });
    mocks.change.mockResolvedValue({ value: confirmation({ status: 'done', confirmationKind: 'buyer', confirmedAt: '2026-11-26T01:00:00Z' }) });
    await click(false, '구매확정');
    expect(text(render(false))).toContain('구매자 직접 확정 처리를 확인했습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
    /* 고객 화면에는 어드민 확인창이 뜨지 않는다. */
    expect(requests).toHaveLength(0);
  });
});

describe('어드민 주문 상세(admin) — 거래확정과 확인창', () => {
  it('이름은 거래확정 하나이고, 사유 칸은 없으며, 보류 중이 아니면 [보류 해제]가 보이지 않는다', () => {
    mount(confirmation({ automaticActive: false }));
    const html = text(render(true));
    expect(html).not.toContain('구매확정');
    for (const line of ['거래확정', '거래확정되면 주문 당시 정책에 따라 적립금이 지급됩니다.', '거래확정 상태', '확정 전', '자동 확정 안 함', '거래확정 이력 (0)']) expect(html, line).toContain(line);
    expect(buttons(true)).toEqual(['거래확정 요청 알림', '거래확정 보류', '상태 다시 불러오기']);
    /* 고객에게 보일 보류 사유 칸이 버튼 셋 위에 있던 자리는 없다 — 보류를 누르면 그 자리에서 받는다. */
    expect(all(render(true)).some(e => e.type === 'textarea' || e.type === 'label')).toBe(false);
  });
  it('보류 중이면 [보류 해제]만 남기고 사유와 상태를 한 줄로 보인다', () => {
    mount(confirmation({ held: true, holdReason: '사진 확인 중', canConfirm: false, canExtend: false }));
    expect(buttons(true)).toEqual(['보류 해제', '상태 다시 불러오기']);
    expect(text(render(true))).toContain('보류 · 사진 확인 중'); expect(text(render(true))).toContain('보류 해제 전까지 중지');
    /* 예전의 늘 보이는 경고 문장은 해제 확인창으로 옮겼다. */
    expect(text(render(true))).not.toContain('예정 시각이 지난 보류를 해제하면');
  });
  it('확정된 주문은 거래확정 이름 아래 확정 방식을 적고 버튼을 두지 않는다. 이력은 어드민 이름을 쓴다', () => {
    mount(confirmation({ status: 'done', confirmationKind: 'automatic', confirmedAt: '2026-11-26T01:00:00Z', requestedAt: '2026-11-25T01:00:00Z',
      history: [{ id: '10000000-0000-4000-8000-000000000001', kind: 'request', note: '', at: '2026-11-25T01:00:00Z' }, { id: '10000000-0000-4000-8000-000000000002', kind: 'confirm', note: '', at: '2026-11-26T01:00:00Z' }] }));
    const html = text(render(true));
    expect(html).toContain('거래확정(자동 확정) · 2026. 11. 26. 10:00');
    expect(html).toContain('거래확정 요청'); expect(html).toContain('앱 알림'); expect(html).not.toContain('인앱 알림');
    expect(html).toContain('거래확정 요청'); expect(html).toContain('구매자 직접 확정');
    expect(buttons(true)).toEqual(['상태 다시 불러오기']);
    mount(confirmation({ status: 'done', confirmationKind: 'buyer', confirmedAt: null }));
    expect(text(render(true))).toContain('거래확정(구매자 직접 확정) · 시각 기록 없음');
  });
  it('로그인·불러오기·처리 결과를 모르는 말도 어드민 버튼 이름으로 안내한다', async () => {
    mount(null, { blocked: true });
    expect(text(render(true))).toBe('로그인이 바뀌었습니다. 주문 화면을 다시 열어 주세요.');
    mount(null, { message: '' });
    expect(text(render(true))).toContain('거래확정 상태를 확인하고 있습니다.');
    mount(confirmation()); mocks.change.mockRejectedValue(new Error('lost')); answer = true;
    await click(true, '거래확정 요청 알림');
    expect(text(render(true))).toContain('처리됐는지 확인하지 못했습니다. [상태 다시 불러오기]를 눌러 주세요.');
    expect(all(render(true)).filter(e => e.type === 'button').slice(0, 2).every(e => e.props.disabled)).toBe(true);
  });
  it('[거래확정 요청 알림]은 고객에게 알림이 가고 한 번만 보낼 수 있다고 묻고, 돌아가면 보내지 않는다', async () => {
    mount(confirmation()); answer = false;
    await click(true, '거래확정 요청 알림');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ title: '거래확정 요청 알림', message: '주문 20261126140010000034의 구매자에게 거래확정 요청 알림을 보냅니다. 한 주문에 한 번만 보낼 수 있습니다.', confirmLabel: '알림 보내기', cancelLabel: '돌아가기' });
    expect(mocks.change).not.toHaveBeenCalled();
    answer = true; mocks.change.mockResolvedValue({ value: confirmation({ requestedAt: '2026-11-26T02:00:00Z' }) });
    await click(true, '거래확정 요청 알림');
    expect(mocks.change).toHaveBeenCalledWith(ORDER, 'request', '', 3, expect.any(String), IDENTITY, true, false);
    expect(text(render(true))).toContain('구매자에게 거래확정 요청 알림을 보냈습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
    /* 이미 보냈으면 버튼이 눌리지 않는다. */
    expect(all(render(true)).find(e => e.type === 'button' && text(e) === '거래확정 요청 알림')?.props.disabled).toBe(true);
  });
  it('[거래확정 보류]는 고객에게 보일 사유를 그 자리에서 받고, 사유가 없으면 서버로 가지 않는다', async () => {
    mount(confirmation()); reply = '상품 사진 확인 중';
    mocks.change.mockResolvedValue({ value: confirmation({ held: true, holdReason: reply, canConfirm: false }) });
    await click(true, '거래확정 보류');
    expect(requests[0]).toMatchObject({ title: '거래확정 보류', confirmLabel: '보류', cancelLabel: '돌아가기',
      input: { label: '고객에게 보일 보류 사유 (필수)', minLength: 1, maxLength: 500 } });
    expect(requests[0].message).toBe('주문 20261126140010000034의 거래확정을 보류합니다. 보류하면 자동 확정이 멈추고 구매자도 직접 거래확정할 수 없습니다. 아래 사유는 고객 주문 화면에 그대로 보입니다.');
    expect(mocks.change).toHaveBeenCalledWith(ORDER, 'hold', '상품 사진 확인 중', 3, expect.any(String), IDENTITY, true, false);
    expect(text(render(true))).toContain('거래확정을 보류했습니다. 보류 사유가 고객 주문 화면에 보입니다.');
    mount(confirmation()); mocks.change.mockClear(); answer = false;
    await click(true, '거래확정 보류');
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it('[보류 해제]는 자동 확정 예정 시각이 지났으면 바로 거래확정되고 적립금이 지급될 수 있다고 묻는다', async () => {
    mount(confirmation({ held: true, holdReason: '사진 확인', canConfirm: false })); mocks.change.mockResolvedValue({ value: confirmation() });
    await click(true, '보류 해제');
    expect(requests[0]).toMatchObject({ title: '보류 해제', confirmLabel: '보류 해제', cancelLabel: '돌아가기' });
    expect(requests[0].message).toBe('주문 20261126140010000034의 보류를 풉니다. 구매자가 직접 거래확정할 수 있게 됩니다. 자동 확정 예정 시각(2026. 12. 1. 09:00)이 이미 지났으면 다음 자동 처리에서 바로 거래확정되고, 정책에 따라 적립금이 지급됩니다.');
    expect(mocks.change).toHaveBeenCalledWith(ORDER, 'resume', '', 3, expect.any(String), IDENTITY, true, false);
    expect(text(render(true))).toContain('보류를 해제했습니다.');
    /* 자동 확정 대상이 아닌 주문은 예정 시각 문장이 없다. */
    mount(confirmation({ held: true, holdReason: '사진 확인', canConfirm: false, automaticActive: false, autoDueAt: null })); requests.length = 0;
    await click(true, '보류 해제');
    expect(requests[0].message).toBe('주문 20261126140010000034의 보류를 풉니다. 구매자가 직접 거래확정할 수 있게 됩니다.');
    /* 번호를 모르는 옛 주문은 번호 자리를 말로 쓴다. */
    mount(confirmation({ held: true, holdReason: '사진 확인', canConfirm: false, automaticActive: false, autoDueAt: null })); requests.length = 0; hooks.index = 0; hooks.refIndex = 0;
    const noNumber = PurchaseConfirmationPanel({ orderId: ORDER, actorId: IDENTITY.actorId, admin: true }) as Element;
    all(noNumber).find(e => e.type === 'button' && text(e) === '보류 해제')?.props.onClick?.(); await settle();
    expect(requests[0].message).toBe('이 주문의 보류를 풉니다. 구매자가 직접 거래확정할 수 있게 됩니다.');
  });
});
