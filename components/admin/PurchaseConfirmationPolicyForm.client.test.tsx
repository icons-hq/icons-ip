import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/* 이 저장소의 화면 시험 방식: 컴포넌트를 함수로 불러 요소 트리를 걷고, 상태 훅은 순서대로 모킹한다(같은 폴더의 *.client.test.tsx). */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  /* 전환 안에서 확인창을 띄우면 실제 브라우저에서는 창이 뜨지 않고 멈춘다(확인창을 그리는 갱신이 전환이 끝날 때까지 미뤄진다).
     그 순서가 되돌아오면 시험이 실패하도록, 전환이 도는 동안 뜬 확인창을 센다. */
  useTransition: () => [false, (run: () => unknown) => { transition.depth++; void Promise.resolve(run()).finally(() => { transition.depth--; }); }],
}));
const transition = vi.hoisted(() => ({ depth: 0, confirmsInside: 0 }));
vi.mock('@/app/admin/purchase-confirmation-actions', () => ({ previewPurchaseConfirmationAutoAction: mocks.preview, readPurchaseConfirmationPolicyAction: mocks.read, savePurchaseConfirmationPolicyAction: mocks.save }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));

import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { GoodChoiceCard } from './GoodEditorParts';
import { AdminField } from './console/AdminKit';
import { PurchaseConfirmationPolicyForm } from './PurchaseConfirmationPolicyForm';

type Props = { children?: ReactNode; id?: string; value?: string; type?: string; role?: string; disabled?: boolean; error?: string; inputId?: string;
  onChange?: (event: unknown) => void; onClick?: () => void; onSubmit?: (event: unknown) => void };
type Element = ReactElement<Props>;
const ACTOR = 'b1000000-0000-4000-8000-000000000001', SESSION = 'b1000000-0000-4000-8000-000000000002';
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as Props).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as Props).children) : typeof node === 'string' ? node : ''; }
function render(initial: PurchaseConfirmationPolicy) { hooks.index = 0; hooks.refIndex = 0; return PurchaseConfirmationPolicyForm({ initial, actorId: ACTOR, sessionId: SESSION }) as Element; }
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }

const off: PurchaseConfirmationPolicy = { revision: 4, autoEnabled: false, autoAfterDays: null, buyerExtensionDays: null, evidence: '', updatedAt: '2026-11-01T00:00:00Z' };
const on: PurchaseConfirmationPolicy = { revision: 5, autoEnabled: true, autoAfterDays: 8, buyerExtensionDays: 3, evidence: '', updatedAt: '2026-11-02T00:00:00Z' };
const preview = { autoAfterDays: 7, orderCount: 12, storeCreditTotal: 3400, perRunLimit: 1000, remainingDueCount: 0, asOf: '2026-11-26T03:00:00Z' };

const card = (tree: Element, value: string) => all(tree).find(element => element.type === GoodChoiceCard && element.props.value === value)!;
const input = (tree: Element, id: string) => all(tree).find(element => element.type === Input && element.props.id === id);
const buttons = (tree: Element) => all(tree).filter(element => element.type === Button);
const buttonNamed = (tree: Element, label: string) => buttons(tree).find(element => text(element) === label);
const result = (tree: Element) => all(tree).find(element => element.type === 'p' && (element.props.role === 'status' || element.props.role === 'alert'));
function submit(initial: PurchaseConfirmationPolicy) { all(render(initial)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); return settle(); }
/** '배송완료 뒤 자동 확정'을 고르고 기간을 적는다. */
function turnOn(initial: PurchaseConfirmationPolicy, days: string) {
  card(render(initial), 'on').props.onChange?.({});
  input(render(initial), 'confirmation-auto-days')!.props.onChange?.({ target: { value: days } });
}

let confirm: ReturnType<typeof vi.fn<(request: AdminConfirmRequest) => Promise<boolean>>>;
let release: () => void;
beforeEach(() => {
  hooks.state = []; hooks.refs = []; transition.depth = 0; transition.confirmsInside = 0; vi.clearAllMocks();
  confirm = vi.fn(async () => true);
  release = setAdminConfirmHandler((request) => { if (transition.depth > 0) transition.confirmsInside++; return confirm(request); });
  mocks.preview.mockResolvedValue({ preview });
  mocks.save.mockResolvedValue({ policy: { ...on, revision: 5, autoAfterDays: 7, buyerExtensionDays: null } });
});
afterEach(() => { release(); expect(transition.confirmsInside, '확인창은 전환(startTransition) 밖에서 띄운다').toBe(0); });

it('꺼져 있던 자동 거래확정을 켜면 지금 확정될 주문 수와 적립금을 읽어 확인창으로 보인 뒤에만 저장한다', async () => {
  turnOn(off, '7');
  await submit(off);

  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(7);
  expect(confirm).toHaveBeenCalledTimes(1);
  const request = confirm.mock.calls[0][0];
  expect(request.title).toBe('자동 거래확정을 켤까요?');
  expect(request.message).toContain('지금 켜면 주문 12건이 다음 03:00 (KST) 자동 처리 때 거래확정되고, 적립금 3,400원이 지급됩니다. 되돌릴 수 없습니다.');
  expect(request.message).toContain('대상은 배송완료 뒤 7일이 지난 주문입니다.');
  /* 수치는 조회 시점 값이다. 저장 사이에 달라질 수 있음을 숨기지 않는다. */
  expect(request.message).toContain('지금 기준 수치입니다.');
  expect(request.confirmLabel).toBe('자동 거래확정 켜기');
  expect(request.cancelLabel).toBe('돌아가기');
  expect(request.destructive).toBe(true);
  /* 확인한 뒤에 저장한다. 근거 글·확인 체크는 보내지 않는다. */
  expect(mocks.preview.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ autoEnabled: true, autoAfterDays: 7, buyerExtensionDays: null }, 4, expect.stringMatching(/^[0-9a-f-]{36}$/), { actorId: ACTOR, sessionId: SESSION });
  const status = result(render(off));
  expect(status?.props.role).toBe('status');
  expect(text(status)).toBe('자동 거래확정을 켰습니다. 기한이 지난 주문은 다음 03:00 (KST) 자동 처리부터 거래확정됩니다.');
});

it('확인창에서 돌아가면 저장하지 않고 적은 값은 그대로 남는다', async () => {
  confirm.mockResolvedValue(false);
  turnOn(off, '7');
  await submit(off);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(mocks.save).not.toHaveBeenCalled();
  const tree = render(off);
  expect(input(tree, 'confirmation-auto-days')?.props.value).toBe('7');
  expect(result(tree)).toBeUndefined();
});

/* DB 리뷰 6-1: 쌓인 주문이 많아 조회가 제한 시간에 걸리면 읽지 못한다. 그때 저장을 막으면 자동 거래확정을 켤 길이 없어진다. */
it('확정될 주문 수를 읽지 못해도 막지 않는다 — 읽지 못했다고 말하고 [그래도 저장]으로 켠다', async () => {
  mocks.preview.mockResolvedValue({ unread: true });
  turnOn(off, '7');
  await submit(off);
  expect(confirm).toHaveBeenCalledTimes(1);
  const request = confirm.mock.calls[0][0];
  expect(request.message.split('\n')).toEqual([
    '지금 켜면 거래확정될 주문 수와 지급될 적립금을 읽지 못했습니다.',
    '그래도 저장하면 배송완료 뒤 7일이 지난 주문이 다음 03:00 (KST) 자동 처리부터 거래확정되고, 주문할 때의 적립 조건대로 적립금이 지급됩니다. 되돌릴 수 없습니다.',
    '[돌아가기]를 누른 뒤 [저장]을 다시 누르면 주문 수를 다시 읽습니다.',
  ]);
  expect(request).toMatchObject({ confirmLabel: '그래도 저장', cancelLabel: '돌아가기', destructive: true });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ autoEnabled: true, autoAfterDays: 7, buyerExtensionDays: null }, 4, expect.any(String), { actorId: ACTOR, sessionId: SESSION });
  expect(text(result(render(off)))).toContain('자동 거래확정을 켰습니다.');
});

it('주문 수를 읽지 못한 확인창에서 돌아가면 저장하지 않고, 다시 [저장]을 누르면 다시 읽는다', async () => {
  mocks.preview.mockRejectedValueOnce(new Error('network'));
  confirm.mockResolvedValueOnce(false);
  turnOn(off, '7');
  await submit(off);
  expect(confirm.mock.calls[0][0].confirmLabel).toBe('그래도 저장');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(result(render(off))).toBeUndefined();
  expect(buttonNamed(render(off), '저장')?.props.disabled).toBe(false);

  await submit(off);
  expect(mocks.preview).toHaveBeenCalledTimes(2);
  expect(confirm.mock.calls[1][0].confirmLabel).toBe('자동 거래확정 켜기');
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('권한이 없어 읽지 못한 것이면 저장도 되지 않으므로 확인창 없이 그 이유를 보인다', async () => {
  mocks.preview.mockResolvedValue({ error: '거래확정 정책을 바꿀 권한이 없거나 로그인이 끝났습니다. 다시 로그인한 뒤 이 화면을 다시 열어주세요.' });
  turnOn(off, '7');
  await submit(off);
  expect(confirm).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  const alert = result(render(off));
  expect(alert?.props.role).toBe('alert');
  expect(text(alert)).toContain('권한이 없거나 로그인이 끝났습니다');
});

it('자동 처리 한 번의 한도를 넘으면 확인창이 다음 실행분의 수치와 넘어가는 주문 수를 나눠 말한다', async () => {
  mocks.preview.mockResolvedValue({ preview: { ...preview, orderCount: 1000, storeCreditTotal: 84660, remainingDueCount: 1300 } });
  turnOn(off, '7');
  await submit(off);
  const lines = confirm.mock.calls[0][0].message.split('\n');
  expect(lines[0]).toBe('지금 켜면 주문 1,000건이 다음 03:00 (KST) 자동 처리 때 거래확정되고, 적립금 84,660원이 지급됩니다. 되돌릴 수 없습니다.');
  expect(lines[1]).toBe('한 번에 1,000건까지 거래확정합니다. 기한이 지난 배송완료 주문이 1,300건 더 있고, 취소·반품·교환이 진행 중인 주문 등을 뺀 나머지는 다음 날부터 차례로 거래확정됩니다. 그 주문의 적립금은 위 금액에 들어 있지 않습니다.');
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('주문 수를 읽는 동안에는 칸을 잠그고 버튼이 하는 일을 말하며, 거듭 눌러도 한 번만 읽는다', async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.preview.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  turnOn(off, '7');
  await submit(off);
  let tree = render(off);
  expect(buttonNamed(tree, '거래확정될 주문 수 확인 중…')?.props.disabled).toBe(true);
  expect(all(tree).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await submit(off);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();

  finish({ preview });
  await settle();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  tree = render(off);
  expect(buttonNamed(tree, '저장')?.props.disabled).toBe(false);
});

it('바로 확정될 주문이 없으면 확인창이 그렇게 말하고 위험색을 쓰지 않는다', async () => {
  mocks.preview.mockResolvedValue({ preview: { ...preview, orderCount: 0, storeCreditTotal: 0 } });
  turnOn(off, '7');
  await submit(off);
  const request = confirm.mock.calls[0][0];
  expect(request.message).toContain('지금 기준으로 바로 거래확정되는 주문은 없습니다.');
  expect(request.destructive).toBeUndefined();
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('켤 때 기간을 적지 않았거나 범위를 벗어나면 그 칸에서 알리고 아무것도 보내지 않는다', async () => {
  card(render(off), 'on').props.onChange?.({});
  await submit(off);
  const field = all(render(off)).find(element => element.type === AdminField && element.props.inputId === 'confirmation-auto-days');
  expect(field?.props.error).toBe('1~36,500 사이 숫자로 적어주세요.');
  input(render(off), 'confirmation-auto-days')!.props.onChange?.({ target: { value: '36501' } });
  await submit(off);
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('끌 때는 확인창 없이 저장하고, 무엇이 달라지는지 결과 한 줄로 말한다', async () => {
  mocks.save.mockResolvedValue({ policy: { ...on, revision: 6, autoEnabled: false } });
  card(render(on), 'off').props.onChange?.({});
  /* 끈 쪽을 고르면 기간 칸이 닫힌다. */
  expect(input(render(on), 'confirmation-auto-days')).toBeUndefined();
  await submit(on);
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  /* 끄는 저장이 기간까지 바꾸지 않게 저장돼 있던 기간을 그대로 보낸다. */
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ autoEnabled: false, autoAfterDays: 8, buyerExtensionDays: 3 }, 5, expect.any(String), { actorId: ACTOR, sessionId: SESSION });
  expect(text(result(render(on)))).toBe('자동 거래확정을 껐습니다. 앞으로는 자동으로 거래확정하지 않습니다. 이미 거래확정된 주문은 그대로입니다.');
});

it('켜진 채 기간만 바꾸면 확인창 없이 저장하고, 이미 기한을 받은 주문은 그대로라고 말한다', async () => {
  mocks.save.mockResolvedValue({ policy: { ...on, revision: 6, autoAfterDays: 10 } });
  input(render(on), 'confirmation-auto-days')!.props.onChange?.({ target: { value: '10' } });
  await submit(on);
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ autoEnabled: true, autoAfterDays: 10, buyerExtensionDays: 3 }, 5, expect.any(String), { actorId: ACTOR, sessionId: SESSION });
  expect(text(result(render(on)))).toBe('저장했습니다. 지금부터 배송완료되는 주문에 적용합니다. 이미 기한을 받은 주문은 그 기한 그대로입니다.');
});

it('저장됐는지 모르면 [저장됐는지 확인]이 같은 작업 번호로 다시 보내고, 그동안 값은 잠긴다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', uncertain: true });
  input(render(on), 'confirmation-auto-days')!.props.onChange?.({ target: { value: '10' } });
  await submit(on);
  let tree = render(on);
  expect(result(tree)?.props.role).toBe('alert');
  expect(buttonNamed(tree, '저장')?.props.disabled).toBe(true);
  expect(all(tree).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  expect(buttonNamed(tree, '그만두고 다시 하기')).toBeDefined();
  expect(buttonNamed(tree, '저장된 정책 다시 불러오기')).toBeUndefined();

  mocks.save.mockResolvedValueOnce({ policy: { ...on, revision: 6, autoAfterDays: 10 } });
  buttonNamed(tree, '저장됐는지 확인')!.props.onClick?.();
  await settle();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  tree = render(on);
  expect(buttonNamed(tree, '저장됐는지 확인')).toBeUndefined();
  expect(buttonNamed(tree, '저장')?.props.disabled).toBe(false);
  expect(text(result(tree))).toContain('저장했습니다');
});

it('다른 사람이 먼저 바꿨으면 저장을 잠그고, 다시 불러오면 묻지 않고 지금 정책을 보인다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. [저장된 정책 다시 불러오기]로 지금 정책을 확인한 뒤 다시 저장해주세요.', conflict: true });
  input(render(on), 'confirmation-auto-days')!.props.onChange?.({ target: { value: '10' } });
  await submit(on);
  let tree = render(on);
  expect(text(result(tree))).toContain('다른 사람이 먼저 바꿨습니다.');
  expect(buttonNamed(tree, '저장')?.props.disabled).toBe(true);
  expect(buttonNamed(tree, '저장됐는지 확인')).toBeUndefined();

  mocks.read.mockResolvedValue({ policy: { ...on, revision: 9, autoAfterDays: 14 } });
  buttonNamed(tree, '저장된 정책 다시 불러오기')!.props.onClick?.();
  await settle();
  expect(confirm).not.toHaveBeenCalled();
  tree = render(on);
  expect(input(tree, 'confirmation-auto-days')?.props.value).toBe('14');
  expect(buttonNamed(tree, '저장')?.props.disabled).toBe(false);
  expect(text(result(tree))).toBe('저장된 정책을 다시 불러왔습니다.');
});

it('고친 값이 있는 채 다시 불러오면 적은 내용이 사라진다고 먼저 묻는다', async () => {
  confirm.mockResolvedValue(false);
  input(render(on), 'confirmation-auto-days')!.props.onChange?.({ target: { value: '10' } });
  buttonNamed(render(on), '저장된 정책 다시 불러오기')!.props.onClick?.();
  await settle();
  expect(confirm.mock.calls[0][0].title).toBe('적은 내용을 버리고 저장된 내용을 불러올까요?');
  expect(mocks.read).not.toHaveBeenCalled();
  expect(input(render(on), 'confirmation-auto-days')?.props.value).toBe('10');
});
