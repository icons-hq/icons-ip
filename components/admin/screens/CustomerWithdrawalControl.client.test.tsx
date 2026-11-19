import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0 }));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), process: vi.fn(), retry: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: () => [{}, mocks.process, false],
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
}));
vi.mock('@/app/admin/member-withdrawal-actions', () => ({
  previewMemberWithdrawalInquiryAction: mocks.preview,
  processMemberWithdrawalAction: vi.fn(),
  retryMemberWithdrawalSigninBlockAction: vi.fn(),
}));
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import type { AdminMemberDetail } from '@/lib/admin/members';
import { CustomerWithdrawalControl } from './CustomerWithdrawalControl';

type Element = ReactElement<{ children?: ReactNode; onSubmit?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  if (typeof element.type === 'function') return [element, ...all((element.type as (props: unknown) => ReactNode)(element.props))];
  return [element, ...all(element.props.children)];
}

const MEMBER = '00000000-0000-4000-8000-000000000301';
const customer: AdminMemberDetail = {
  id: MEMBER, nickname: '탈퇴 고객', email: 'leaving@example.test', role: 'user', createdAt: '2026-01-01T00:00:00Z',
  consents: { terms: true, privacy: true, marketing: true }, suspendedAt: null, suspensionReason: null, loyaltyGrade: 'welcome',
  goodsOrderCount: 1, ticketOrderCount: 0, submittedReportCount: 0, receivedReportCount: 0,
  moderation: { managerRole: null, canModerate: true },
  withdrawal: { processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null },
};

/* useRef 순서: 확인 통과 표식(0) · 대조 중 표식(1) · 대조한 번호 숨은 칸(2). */
const confirmedInput = () => hooks.refs[2] as { current: { value: string } };
function submitForm(inquiryReference: string) {
  hooks.stateIndex = 0; hooks.refIndex = 0;
  hooks.state[0] = inquiryReference;
  hooks.refs[2] ??= { current: { value: '' } };
  const form = all(CustomerWithdrawalControl({ actor: { id: 'actor', role: 'admin' }, customer }))
    .find((element) => element.type === 'form' && element.props.onSubmit);
  const target = { isConnected: true, requestSubmit: vi.fn() };
  const event = { preventDefault: vi.fn(), currentTarget: target, nativeEvent: { submitter: 'submit-button' } };
  form!.props.onSubmit!(event);
  return { event, target };
}
const settle = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };

let confirms: AdminConfirmRequest[] = [];
let answer = true;
let restore: () => void = () => {};
beforeEach(() => {
  hooks.state = []; hooks.refs = []; confirms = []; answer = true; vi.clearAllMocks();
  restore = setAdminConfirmHandler(async (request) => { confirms.push(request); return answer; });
});
afterEach(() => restore());

it('제출을 멈추고 문의 유형·제목·작성일을 확인창에서 대조한 뒤 같은 제출자로 다시 제출한다', async () => {
  mocks.preview.mockResolvedValue({ ok: true, inquiry: { reference: 1234, category: 'account', title: '회원 탈퇴 요청합니다', createdAt: '2026-11-18T01:00:00Z' } });
  const { event, target } = submitForm('#1234');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  await settle();
  expect(mocks.preview).toHaveBeenCalledWith(MEMBER, '#1234');
  expect(confirms).toHaveLength(1);
  expect(confirms[0]).toMatchObject({ title: '탈퇴 요청 처리', confirmLabel: '탈퇴 처리', destructive: true });
  expect(confirms[0].message).toContain('문의 #1234 · 계정 · 회원 탈퇴 요청합니다');
  expect(confirms[0].message).not.toContain('주의');
  expect(target.requestSubmit).toHaveBeenCalledWith('submit-button');
  expect(confirmedInput().current.value).toBe('1234');
});

it('대조하는 동안의 거듭 제출은 무시하고 입력은 읽기 전용이다', async () => {
  let resolve: (value: unknown) => void = () => {};
  mocks.preview.mockReturnValue(new Promise((done) => { resolve = done; }));
  const first = submitForm('1234');
  const second = submitForm('1234');
  expect(second.event.preventDefault).toHaveBeenCalledOnce();
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  hooks.stateIndex = 0; hooks.refIndex = 0;
  const tree = all(CustomerWithdrawalControl({ actor: { id: 'actor', role: 'admin' }, customer }));
  const fields = tree.filter((element) => (element.props as { name?: string }).name === 'inquiryReference' || (element.props as { name?: string }).name === 'note');
  expect(new Set(fields.map((element) => (element.props as { name?: string }).name))).toEqual(new Set(['inquiryReference', 'note']));
  expect(fields.every((element) => (element.props as { readOnly?: boolean }).readOnly === true)).toBe(true);
  resolve({ ok: false, error: '중단' });
  await settle();
  expect(first.target.requestSubmit).not.toHaveBeenCalled();
});

it('계정 유형이 아닌 문의는 경고를 앞에 두고, 취소하면 제출하지 않는다', async () => {
  answer = false;
  mocks.preview.mockResolvedValue({ ok: true, inquiry: { reference: 77, category: 'order', title: '배송 언제 오나요', createdAt: '2026-10-01T01:00:00Z' } });
  const { target } = submitForm('77');
  await settle();
  expect(confirms[0].message).toMatch(/^주의: 이 문의는 '계정' 유형이 아닙니다\(주문\/배송\)/);
  expect(confirms[0].message).toContain('배송 언제 오나요');
  expect(target.requestSubmit).not.toHaveBeenCalled();
});

it('그 회원의 문의가 아니면 확인창 없이 멈추고 이유를 보인다', async () => {
  mocks.preview.mockResolvedValue({ ok: false, error: '이 회원이 쓴 1:1 문의 번호가 아닙니다.' });
  const { target } = submitForm('999');
  await settle();
  expect(confirms).toHaveLength(0);
  expect(target.requestSubmit).not.toHaveBeenCalled();
  expect(hooks.state).toContain('이 회원이 쓴 1:1 문의 번호가 아닙니다.');
});
