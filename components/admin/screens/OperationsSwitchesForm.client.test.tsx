import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useId: () => 'sw',
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
const guard = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/useAdminLeaveGuard', () => ({ useAdminLeaveGuard: guard }));
vi.mock('@/app/admin/operations-switches-actions', () => ({
  saveOrderDelayNoticeSwitchAction: vi.fn(), savePartialCancelSwitchAction: vi.fn(), saveReturnFeeDeductionSwitchAction: vi.fn(),
}));
import { SwitchSection, type SectionProps } from './OperationsSwitchesForm';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { OPERATIONS_SWITCH_CHECKLISTS, type OperationsSwitchesState } from '@/lib/admin/operations-switches';

type Element = ReactElement<{ children?: ReactNode; id?: string; type?: string; role?: string; disabled?: boolean; onChange?: (event: unknown) => void;
  onSubmit?: (event: unknown) => void; onClick?: () => void; summary?: ReactNode }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }

const doc: OperationsSwitchesState = {
  delayNotice: { revision: 2, enabled: true, smsEnabled: false, evidence: 'TEST 근거', changedAt: '2026-11-19T01:00:00Z', updatedBy: '운영자' },
  returnFee: { revision: 3, enabled: true, oneWayAmount: 3000, evidence: 'TEST 근거', enabledAt: '2026-11-19T01:00:00Z', updatedAt: '2026-11-19T01:00:00Z', updatedBy: '운영자', inflightCount: 2 },
  partialCancel: { revision: 3, enabled: false, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', updatedBy: '운영자' },
  partialReturn: { revision: 3, enabled: false, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', updatedBy: '운영자' },
};
const save = vi.fn(), onSaved = vi.fn();
let confirm: ReturnType<typeof stubAdminConfirm>;
function props(over: Partial<SectionProps> = {}): SectionProps {
  return { kind: 'returnFee', title: '반품배송비 차감', description: '설명', enabled: false, revision: 3, evidence: null, updatedBy: null, updatedAt: null,
    evidenceMax: 1000, amountInitial: null, confirmOn: '켤까요?', confirmOff: '끌까요?', save, onSaved, ...over };
}
function render(p: SectionProps) { hooks.index = 0; hooks.refIndex = 0; return SwitchSection(p) as Element; }
const form = (tree: Element) => all(tree).find((element) => element.type === 'form')!;
const evidence = (tree: Element) => all(tree).find((element) => element.props.id === 'sw-evidence')!;
const amount = (tree: Element) => all(tree).find((element) => element.props.id === 'sw-amount')!;
const checkboxes = (tree: Element) => all(tree).filter((element) => element.type === 'input' && element.props.type === 'checkbox');
const result = (tree: Element) => all(tree).find((element) => element.type === 'p' && (element.props.role === 'status' || element.props.role === 'alert'));
const submit = (tree: Element) => form(tree).props.onSubmit?.({ preventDefault: () => {} });

beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); confirm = stubAdminConfirm(true); save.mockResolvedValue({ state: doc }); });
afterEach(() => confirm.restore());

it('꺼진 스위치는 확인 항목을 모두 체크하기 전에는 저장 호출 없이 이유를 알린다', async () => {
  const p = props();
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 약관 개정 공지' } });
  amount(render(p)).props.onChange?.({ target: { value: '3000' } });
  submit(render(p)); await settle();
  expect(save).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(text(result(render(p)))).toContain('확인 항목');
});

it('근거와 금액이 올바르지 않으면 저장하지 않는다', async () => {
  const p = props();
  checkboxes(render(p)).forEach((box, index) => box.props.onChange?.({ target: { checked: true } }) ?? index);
  evidence(render(p)).props.onChange?.({ target: { value: '가' } });
  amount(render(p)).props.onChange?.({ target: { value: '3000' } });
  submit(render(p)); await settle();
  expect(text(result(render(p)))).toContain('2자 이상');
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 약관 개정 공지' } });
  amount(render(p)).props.onChange?.({ target: { value: '0' } });
  submit(render(p)); await settle();
  expect(text(result(render(p)))).toContain('1원 이상');
  expect(save).not.toHaveBeenCalled();
});

it('모두 확인하고 근거·금액을 적으면 확인창을 거쳐 한 번만 저장한다', async () => {
  const p = props();
  expect(checkboxes(render(p))).toHaveLength(OPERATIONS_SWITCH_CHECKLISTS.returnFee.length);
  for (let n = 0; n < checkboxes(render(p)).length; n++) checkboxes(render(p))[n].props.onChange?.({ target: { checked: true } });
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 약관 개정 공지' } });
  amount(render(p)).props.onChange?.({ target: { value: '3000' } });
  submit(render(p)); await settle();
  expect(confirm).toHaveBeenCalledExactlyOnceWith('켤까요?');
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ enabled: true, amount: 3000, evidence: 'TEST 약관 개정 공지', revision: 3 }));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(doc);
  expect(text(result(render(p)))).toContain('켰습니다');
});

it('확인창에서 취소하면 저장하지 않는다', async () => {
  confirm.restore(); confirm = stubAdminConfirm(false);
  const p = props({ kind: 'partialCancel', title: '재고 부족 부분 취소', amountInitial: undefined, evidenceMax: 1000 });
  for (let n = 0; n < checkboxes(render(p)).length; n++) checkboxes(render(p))[n].props.onChange?.({ target: { checked: true } });
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 부분 취소 확인' } });
  submit(render(p)); await settle();
  expect(confirm).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it('이메일 설정이 준비되지 않았으면 꺼진 스위치를 켜지 못하고 안내한다', async () => {
  const p = props({ kind: 'delayNotice', title: '주문 지연 안내 이메일', amountInitial: undefined, evidenceMax: 500, blocked: '이메일 공급자 설정이 준비되지 않아 지금은 켤 수 없습니다.' });
  expect(text(render(p))).toContain('지금은 켤 수 없습니다');
  for (let n = 0; n < checkboxes(render(p)).length; n++) checkboxes(render(p))[n].props.onChange?.({ target: { checked: true } });
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 발신자 승인' } });
  submit(render(p)); await settle();
  expect(save).not.toHaveBeenCalled();
  expect(text(result(render(p)))).toContain('켤 수 없습니다');
});

it('켜진 스위치는 확인 항목 없이 끌 수 있고 근거 없이 보낸다', async () => {
  const p = props({ enabled: true, evidence: 'TEST 근거', amountInitial: 3000 });
  expect(checkboxes(render(p))).toHaveLength(0);
  const off = all(render(p)).find((element) => element.type !== 'form' && element.props.onClick && text(element) === '끄기')!;
  off.props.onClick?.(); await settle();
  expect(confirm).toHaveBeenCalledExactlyOnceWith('끌까요?');
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ enabled: false, amount: null, evidence: null, revision: 3 }));
});

it('결과가 불확실하면 같은 요청 ID로만 다시 확인하고 확정 실패는 요청을 비운다', async () => {
  const p = props({ enabled: true, evidence: 'TEST 근거', amountInitial: 3000 });
  save.mockResolvedValueOnce({ error: '결과 불명', uncertain: true });
  submit(render(p)); await settle();
  const first = save.mock.calls[0][0].id;
  expect(text(result(render(p)))).toBe('결과 불명');
  submit(render(p)); await settle();
  expect(save.mock.calls[1][0].id).toBe(first);
  expect(confirm).toHaveBeenCalledOnce();
  save.mockResolvedValueOnce({ error: '다른 관리자가 먼저 설정을 바꿨습니다.' });
  hooks.state = []; hooks.refs = [];
  submit(render(p)); await settle();
  expect(text(result(render(p)))).toContain('다른 관리자');
});

it('결과가 불확실한 동안 입력은 잠기지만 [같은 요청 결과 확인] 버튼은 눌러 다시 확인할 수 있다', async () => {
  const p = props({ enabled: true, evidence: 'TEST 근거', amountInitial: 3000 });
  save.mockResolvedValueOnce({ error: '결과 불명', uncertain: true });
  submit(render(p)); await settle();
  const tree = render(p);
  const retry = all(tree).find((element) => element.props.type === 'submit')!;
  expect(text(retry)).toBe('같은 요청 결과 확인');
  expect(retry.props.disabled).toBe(false);
  expect(all(tree).find((element) => element.type === 'fieldset')!.props.disabled).toBe(true);
  const off = all(tree).find((element) => element.props.onClick && text(element) === '끄기')!;
  expect(off.props.disabled).toBe(true);
});

it('고치던 입력·체크·저장 중·결과 불확실 상태를 이동 가드에 등록한다', async () => {
  const last = () => guard.mock.calls.at(-1)![0] as { dirty: boolean; blocked: boolean; message: string };
  const p = props({ enabled: true, evidence: 'TEST 근거', amountInitial: 3000 });
  render(p);
  expect(last()).toMatchObject({ dirty: false, blocked: false });
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 근거 수정' } });
  render(p);
  expect(last().dirty).toBe(true);
  evidence(render(p)).props.onChange?.({ target: { value: 'TEST 근거' } });
  render(p);
  expect(last().dirty).toBe(false);
  amount(render(p)).props.onChange?.({ target: { value: '4000' } });
  render(p);
  expect(last().dirty).toBe(true);
  amount(render(p)).props.onChange?.({ target: { value: '3000' } });
  save.mockResolvedValueOnce({ error: '결과 불명', uncertain: true });
  submit(render(p)); await settle();
  render(p);
  expect(last().dirty).toBe(true);
  expect(last().message).toContain('같은 요청으로 다시 확인할 수 없습니다');
  // 꺼진 스위치의 확인 체크만 해도 저장하지 않은 입력이다.
  hooks.state = []; hooks.refs = [];
  const off = props();
  checkboxes(render(off))[0].props.onChange?.({ target: { checked: true } });
  render(off);
  expect(last().dirty).toBe(true);
});
