import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';

/* 저장 흐름: 저장 전 확인창(이전 → 새 값, 적용 범위) 한 번, 근거·확인 체크 없이 값 셋만 보낸다, 저장됐는지 모를 때는 다시 보내지 않고 저장된 설정을 읽어 알려 준다. */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
  useTransition: () => [false, (run: () => unknown) => { void run(); }] }));
vi.mock('@/app/admin/claim-fee-policy-actions', () => ({ readClaimFeePolicyAction: mocks.read, saveClaimFeePolicyAction: mocks.save }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: () => undefined }) }));
vi.mock('@/lib/admin/confirm', () => ({ adminConfirm: mocks.confirm }));

import { ClaimFeePolicyForm } from './ClaimFeePolicyForm';

type Element = ReactElement<{ children?: ReactNode; id?: string; value?: string; checked?: boolean; disabled?: boolean; tone?: string; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
const ACTOR = 'a1000000-0000-4000-8000-000000000001', SESSION = 'a1000000-0000-4000-8000-000000000002';
const policy: ClaimFeePolicy = { revision: 3, enabled: true, returnAmount: 3000, exchangeAmount: null, evidence: '예전에 적어 둔 근거', updatedAt: '2026-11-01T00:00:00Z', accountReady: true };
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
let initial = policy;
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimFeePolicyForm({ initial, actorId: ACTOR, sessionId: SESSION }); }
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
function type(id: string, value: string) { const input = all(render()).find(e => e.props.id === id); if (!input) throw new Error(id); input.props.onChange?.({ target: { value } }); }
function choose(value: 'on' | 'off') { const card = all(render()).find(e => e.props.value === value); if (!card) throw new Error(value); card.props.onChange?.({}); }
const button = (label: string) => all(render()).find(e => text(e) === label && typeof e.props.onClick === 'function');
const notice = () => { const found = all(render()).find(e => typeof e.props.tone === 'string'); return found ? { tone: found.props.tone, text: text(found) } : null; };
const screen = () => text(render());
beforeEach(() => { hooks.state = []; hooks.refs = []; initial = policy; vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); });

it('저장 전에 바뀌는 금액(이전 → 새 값)과 적용 범위를 확인창으로 한 번 보이고, 값 셋만 보낸다', async () => {
  mocks.save.mockResolvedValue({ policy: { ...policy, revision: 4, returnAmount: 3500, exchangeAmount: 6000 } });
  type('claim-fee-policy-return', '3500'); type('claim-fee-policy-exchange', '6000'); await submit();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ title: '배송비 청구 설정 저장', confirmLabel: '설정 저장', cancelLabel: '돌아가기' });
  const message: string = mocks.confirm.mock.calls[0][0].message;
  expect(message).toContain('반품 기본 청구 금액: 3,000원 → 3,500원'); expect(message).toContain('교환 기본 청구 금액: 없음 → 6,000원');
  expect(message).toContain('이미 청구한 배송비의 금액은 바뀌지 않습니다.'); expect(message).not.toContain('배송비 청구: ');
  /* 근거(evidence)와 확인 체크(confirmed)는 보내지 않는다. 화면이 연 저장 번호(revision)와 로그인 정보를 함께 보낸다. */
  expect(mocks.save).toHaveBeenCalledOnce();
  const [values, revision, operation, identity] = mocks.save.mock.calls[0];
  expect(values).toEqual({ enabled: true, returnAmount: 3500, exchangeAmount: 6000 }); expect(revision).toBe(3);
  expect(operation).toMatch(/^[0-9a-f-]{36}$/); expect(identity).toEqual({ actorId: ACTOR, sessionId: SESSION });
  expect(notice()).toEqual({ tone: 'success', text: '배송비 청구 설정을 저장했습니다.' });
  expect(button('저장됐는지 확인')).toBeUndefined();
});

it('확인창에서 돌아가면 저장하지 않고 적은 내용은 그대로다', async () => {
  mocks.confirm.mockResolvedValue(false); type('claim-fee-policy-return', '5000'); await submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(all(render()).find(e => e.props.id === 'claim-fee-policy-return')?.props.value).toBe('5000');
  /* 다시 누르면 확인창이 다시 뜬다(앞선 확인이 저장을 막아 두지 않는다). */
  await submit(); expect(mocks.confirm).toHaveBeenCalledTimes(2);
});

it('바뀐 내용이 없으면 확인창 없이 알려 주고, 금액 형식이 틀리면 칸 아래에서 알려 주며 저장하지 않는다', async () => {
  await submit();
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(notice()).toEqual({ tone: 'info', text: '바뀐 내용이 없습니다.' });
  for (const wrong of ['0', '3000.5', '-1', '1000001', '3천원']) {
    type('claim-fee-policy-return', wrong);
    expect(screen()).toContain('기본 청구 금액은 1원부터 1,000,000원까지 원 단위 숫자로 적거나 비워 주세요.');
    expect(all(render()).find(e => e.props.id === 'claim-fee-policy-return')?.props['aria-invalid' as 'id']).toBe(true);
    await submit();
  }
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  /* 비우면 '청구할 때 직접 적음'이다. */
  mocks.save.mockResolvedValue({ policy: { ...policy, revision: 4, returnAmount: null } }); type('claim-fee-policy-return', ''); await submit();
  expect(mocks.save.mock.calls[0][0]).toEqual({ enabled: true, returnAmount: null, exchangeAmount: null });
});

it('끌 때는 새 청구만 막힌다는 것을 확인창이 말하고, 닫힌 금액 칸의 값은 저장된 그대로 보낸다', async () => {
  mocks.save.mockResolvedValue({ policy: { ...policy, revision: 4, enabled: false } });
  type('claim-fee-policy-return', '9999'); choose('off');
  expect(all(render()).find(e => e.props.id === 'claim-fee-policy-return')).toBeUndefined();
  await submit();
  const message: string = mocks.confirm.mock.calls[0][0].message;
  expect(message).toContain('배송비 청구: 고객과 합의한 요청에만 직접 청구 → 쓰지 않음');
  expect(message).toContain('새로 청구할 수 없게 됩니다. 이미 청구한 건의 입금 확인·면제·취소·반환은 계속 할 수 있습니다.');
  expect(message).not.toContain('기본 청구 금액');
  expect(mocks.save.mock.calls[0][0]).toEqual({ enabled: false, returnAmount: 3000, exchangeAmount: null });
});

it('켤 때는 이미 접수된 요청에도 바로 적용된다는 것을 확인창이 말한다', async () => {
  initial = { ...policy, enabled: false, returnAmount: null }; mocks.save.mockResolvedValue({ policy: { ...policy, revision: 4, returnAmount: 3000 } });
  choose('on'); type('claim-fee-policy-return', '3000'); await submit();
  const message: string = mocks.confirm.mock.calls[0][0].message;
  expect(message).toContain('배송비 청구: 쓰지 않음 → 고객과 합의한 요청에만 직접 청구');
  expect(message).toContain('이미 접수돼 진행 중인 반품·교환 요청에도 요청 상세에서 [새 배송비 청구]를 쓸 수 있게 됩니다. 환불을 접수해 반품배송비를 환불액에서 빼기로 정해진 반품은 쓸 수 없고, 환불을 접수하기 전 반품에서 청구하면 그 반품은 환불액에서 반품배송비를 빼지 않습니다. 자동으로 청구되지는 않습니다.');
  expect(mocks.save.mock.calls[0][0]).toEqual({ enabled: true, returnAmount: 3000, exchangeAmount: null });
});

it('저장됐는지 모르면 입력을 잠그고 [저장됐는지 확인]으로 저장된 설정을 읽어 결과를 알려 준다(다시 보내지 않는다)', async () => {
  mocks.save.mockRejectedValue(new Error('network')); type('claim-fee-policy-return', '3500'); await submit();
  expect(notice()).toEqual({ tone: 'danger', text: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.' });
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true);
  expect(all(render()).find(e => text(e) === '설정 저장')?.props.disabled).toBe(true);
  /* 읽지 못하면 그대로 잠근 채 다시 누르게 한다. */
  mocks.read.mockResolvedValueOnce({ error: '저장된 설정을 불러오지 못했습니다. 잠시 뒤 [저장됐는지 확인]을 다시 눌러 주세요.' }); button('저장됐는지 확인')!.props.onClick?.(); await settle();
  expect(notice()?.text).toContain('저장된 설정을 불러오지 못했습니다.'); expect(button('저장됐는지 확인')).toBeDefined();
  /* 저장돼 있지 않았다: 적은 내용을 두고 다시 저장하게 한다. */
  mocks.read.mockResolvedValueOnce({ policy }); button('저장됐는지 확인')!.props.onClick?.(); await settle();
  expect(notice()).toEqual({ tone: 'danger', text: '저장되지 않았습니다. 적은 내용은 그대로 있습니다. 다시 [설정 저장]을 눌러 주세요.' });
  expect(all(render()).find(e => e.props.id === 'claim-fee-policy-return')?.props.value).toBe('3500');
  expect(button('저장됐는지 확인')).toBeUndefined(); expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(false);
  expect(mocks.save).toHaveBeenCalledOnce();
  /* 저장돼 있었다: 저장된 값으로 맞추고 알린다. */
  mocks.save.mockResolvedValueOnce({ error: '저장됐는지 확인하지 못했습니다.', saved: 'unknown' }); await submit();
  mocks.read.mockResolvedValueOnce({ policy: { ...policy, revision: 4, returnAmount: 3500 } }); button('저장됐는지 확인')!.props.onClick?.(); await settle();
  expect(notice()).toEqual({ tone: 'success', text: '배송비 청구 설정을 저장했습니다.' });
});

it('다른 사람이 먼저 바꿨으면 지금 저장된 설정을 알려 주고, 적은 내용으로 다시 저장할 때 그 설정을 기준으로 묻는다', async () => {
  const latest = { ...policy, revision: 7, returnAmount: 4000, exchangeAmount: 8000 };
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다.', saved: 'no', changed: true, latest });
  type('claim-fee-policy-return', '3500'); await submit();
  expect(notice()).toEqual({ tone: 'warning', text: "다른 사람이 먼저 바꿨습니다. 지금 저장된 설정은 '고객과 합의한 요청에만 직접 청구 · 반품 4,000원 · 교환 8,000원'입니다. 적은 내용으로 바꾸려면 다시 [설정 저장]을 눌러 주세요." });
  expect(all(render()).find(e => e.props.id === 'claim-fee-policy-return')?.props.value).toBe('3500');
  expect(button('저장됐는지 확인')).toBeUndefined();
  mocks.save.mockResolvedValueOnce({ policy: { ...latest, revision: 8, returnAmount: 3500, exchangeAmount: null } }); await submit();
  const message: string = mocks.confirm.mock.calls[1][0].message;
  expect(message).toContain('반품 기본 청구 금액: 4,000원 → 3,500원'); expect(message).toContain('교환 기본 청구 금액: 8,000원 → 없음');
  expect(mocks.save.mock.calls[1][1]).toBe(7);
});

it('저장되지 않은 것이 분명한 오류는 입력을 잠그지 않고 고칠 방법을 보인다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.', saved: 'no' });
  type('claim-fee-policy-return', '3500'); await submit();
  expect(notice()).toEqual({ tone: 'danger', text: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.' });
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(false); expect(button('저장됐는지 확인')).toBeUndefined();
});
