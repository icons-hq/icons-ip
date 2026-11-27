import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), runtime: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
  useTransition: () => [false, (callback: () => void | Promise<void>) => { void callback(); }],
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/app/admin/shipment-delivery-actions', () => ({ readDeliveryPoliciesAction: mocks.read, saveDeliveryPolicyAction: mocks.save }));
vi.mock('@/app/admin/goods-transaction-runtime-actions', () => ({ readGoodsTransactionRuntimeAction: mocks.runtime }));
import { DeliveryPoliciesPanel, DeliveryPolicyForm, SavedDeliveryPolicy } from './DeliveryPoliciesPanel';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { AdminDeliveryPolicy } from '@/lib/shipment-delivery';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const origin = '00000000-0000-4000-8000-000000042201';
const filled = { contactName: '물류팀 김담당', contactPhone: '02-0000-0000', handoffLocation: '김포 1층 데스크', handoffInstructions: '주문번호를 말해 주세요.',
  appointmentInstructions: '평일 10~17시', completionInstructions: '수령 확인값을 보여 주세요.', cancellationInstructions: '받기 전까지 취소할 수 있습니다.' };
const policy: AdminDeliveryPolicy = { id: '00000000-0000-4000-8000-000000042301', originId: origin, method: 'quick', revision: 3, state: 'active', ...filled, allowDelegate: false,
  approvalReference: '협조전-20261101', createdAt: '2026-11-01T00:00:00Z', activatedAt: '2026-11-02T00:00:00Z', stoppedAt: null };
/** 폼 제출 흉내: 화면의 폼 대신 칸 이름 → 값을 넘긴다. */
class FakeFormData {
  values = new Map<string, string>();
  constructor(source?: { fields?: Record<string, string> }) { for (const [key, value] of Object.entries(source?.fields ?? {})) this.values.set(key, value); }
  get(key: string) { return this.values.has(key) ? this.values.get(key)! : null; }
  set(key: string, value: string) { this.values.set(key, String(value)); }
}
let render: () => ReactNode, saved: ReturnType<typeof vi.fn<(message: string) => void>>, confirm: ReturnType<typeof stubAdminConfirm>;
function mount(next: () => ReactNode) { hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.changed = []; render = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0; return next(); }; return render(); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
const sentForm = (call = 0) => (mocks.save.mock.calls[call][0] as FakeFormData).values;
function submit(state: 'draft' | 'active', fields: Record<string, string>) {
  const form = render() as Element; expect(form.type).toBe('form');
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: { fields }, nativeEvent: { submitter: { getAttribute: () => state } } });
}
const submitButton = (value: string) => all(render()).find(node => node.props.type === 'submit' && node.props.value === value)!;

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('FormData', FakeFormData); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  saved = vi.fn<(message: string) => void>(); confirm = stubAdminConfirm(true); mocks.save.mockResolvedValue({ ok: true, message: '옛 문구' }); mocks.runtime.mockResolvedValue(true);
});
afterEach(() => { confirm.restore(); vi.unstubAllGlobals(); });

describe('운영 조건 저장', () => {
  const fields = { originId: origin, policyId: '', revision: '', method: 'pickup', ...filled, allowDelegate: 'true' };
  const form = (props: Partial<Parameters<typeof DeliveryPolicyForm>[0]> = {}) => mount(() => DeliveryPolicyForm({ originId: origin, activeMethods: [], runtime: true, onSaved: saved, ...props }));

  it('[저장하고 사용]은 빈 칸이 있으면 보내지 않고 그 칸 이름을 말한다', async () => {
    form(); submit('active', { ...fields, handoffLocation: ' ', allowDelegate: '' }); await flush();
    expect(mocks.save).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    expect(text(render())).toContain('[저장하고 사용]은 인계 장소 · 대리수령 칸을 채워야 합니다. 모두 고객에게 보이는 내용입니다.');
  });
  it('승인 근거 없이 확인창 한 번 뒤에 사용으로 저장하고, 켠 뒤 고칠 수 없다는 것을 먼저 말한다', async () => {
    form(); submit('active', fields); await flush();
    expect(confirm).toHaveBeenCalledOnce(); const message = confirm.mock.calls[0][0];
    expect(message).toContain('저장하면 바로 이 출고지 상품을 이 방식으로 주문받고, 적은 내용이 고객의 주문서와 주문 상세에 보입니다.'); expect(message).toContain('켠 뒤에는 내용을 고칠 수 없습니다.');
    expect(mocks.save).toHaveBeenCalledOnce(); expect(sentForm().get('state')).toBe('active'); expect(sentForm().has('approvalReference')).toBe(false);
    expect(saved).toHaveBeenCalledWith('‘방문수령’ 방식을 사용으로 켰습니다.');
  });
  it('확인창에서 돌아가면 저장하지 않고 다시 누를 수 있다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false); form(); submit('active', fields); await flush();
    expect(mocks.save).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubAdminConfirm(true); submit('active', fields); await flush(); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('[준비 중으로 저장]은 빈 칸이 있어도 묻지 않고 저장하며, 고객 주문에 아직 쓰이지 않는다고 말한다', async () => {
    form(); submit('draft', { ...fields, handoffLocation: '', allowDelegate: '' }); await flush();
    expect(confirm).not.toHaveBeenCalled(); expect(sentForm().get('state')).toBe('draft');
    expect(saved).toHaveBeenCalledWith('‘방문수령’ 방식을 준비 중으로 저장했습니다. 고객 주문에는 아직 쓰이지 않습니다.');
  });
  it('수령 방식을 고르지 않으면 저장하지 않는다', async () => {
    form(); submit('draft', { ...fields, method: '' }); await flush();
    expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('수령 방식을 골라 주세요.');
  });
  it('같은 방식에 사용 중인 조건이 있으면 켜기 전에 막고, 준비 중으로는 저장할 수 있다', async () => {
    form({ policy: { ...policy, id: '00000000-0000-4000-8000-000000042302', state: 'draft', activatedAt: null }, activeMethods: ['quick'] });
    expect(submitButton('active').props.disabled).toBe(true); expect(submitButton('draft').props.disabled).toBe(false);
    submit('active', { ...fields, method: 'quick' }); await flush(); expect(mocks.save).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    submit('draft', { ...fields, method: 'quick' }); await flush(); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('쇼핑몰 주문 설정이 꺼져 있으면 확인창이 주문서가 아니라 발송관리에서 쓰인다고 말한다', async () => {
    form({ runtime: false }); submit('active', fields); await flush();
    expect(confirm.mock.calls[0][0]).toContain('발주(주문)확인/발송관리에서 주문의 배송 방식을 이 방식으로 바꿀 수 있습니다.'); expect(confirm.mock.calls[0][0]).not.toContain('주문받고');
  });
  it('쇼핑몰 주문 설정이 꺼져 있으면 쓸 곳이 없는 배송없음은 켜기 전에 막고, 발송관리에서 쓰는 방식은 막지 않는다', async () => {
    form({ runtime: false, policy: { ...policy, method: 'none', state: 'draft', activatedAt: null } });
    expect(submitButton('active').props.disabled).toBe(true); expect(text(render())).toContain('지금 쇼핑몰 설정에서는 배송없음 · 직접전달을 쓸 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.');
    submit('active', { ...fields, method: 'none' }); await flush(); expect(mocks.save).not.toHaveBeenCalled();
    form({ runtime: false, policy: { ...policy, state: 'draft', activatedAt: null } }); expect(submitButton('active').props.disabled).toBe(false);
    form({ runtime: true, policy: { ...policy, method: 'none', state: 'draft', activatedAt: null } }); expect(submitButton('active').props.disabled).toBe(false);
  });
  it('저장이 거절되면 그 까닭을 보이고, 결과를 모르면 목록에서 확인하라고 한다', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: '거절 까닭' }); form(); submit('draft', fields); await flush();
    expect(text(render())).toContain('거절 까닭'); expect(saved).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(new Error('network')); submit('draft', fields); await flush();
    expect(text(render())).toContain('저장됐는지 확인하지 못했습니다. [다시 불러오기]를 눌러 목록에서 상태를 확인해 주세요.');
  });
});

describe('사용 안 함으로 바꾸기', () => {
  const stopButton = () => all(render()).find(node => text(node) === '사용 안 함으로 바꾸기' && typeof node.props.onClick === 'function')!;
  it('끄기 전에 막히는 주문·남는 주문·다시 켤 수 없음을 확인창으로 말하고, 돌아가면 그대로 둔다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false); mount(() => SavedDeliveryPolicy({ policy, canEdit: true, runtime: true, onSaved: saved }));
    (stopButton().props.onClick as () => void)(); await flush();
    const message = confirm.mock.calls[0][0];
    for (const part of ['고객이 주문서에서 이 방식을 골랐을 때 새 주문이 막힙니다.', '상품에서 이 방식을 빼기 전까지는 주문서에 계속 보입니다.', '발주(주문)확인/발송관리에서도 주문의 배송 방식을 이 방식으로 바꿀 수 없습니다.',
      '이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다.', '한 번 끈 운영 조건은 다시 켤 수 없습니다.']) expect(message).toContain(part);
    expect(mocks.save).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubAdminConfirm(true); (stopButton().props.onClick as () => void)(); await flush();
    expect([...sentForm()]).toEqual([['originId', origin], ['policyId', policy.id], ['revision', '3'], ['method', 'quick'], ['state', 'stopped']]);
    expect(saved).toHaveBeenCalledWith('‘퀵’ 방식을 사용 안 함으로 바꿨습니다. 이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다.');
  });
  it('주문 설정이 꺼져 있거나 배송없음이면 해당하지 않는 문장은 말하지 않는다', async () => {
    mount(() => SavedDeliveryPolicy({ policy: { ...policy, method: 'none' }, canEdit: true, runtime: false, onSaved: saved }));
    (stopButton().props.onClick as () => void)(); await flush();
    expect(confirm.mock.calls[0][0]).toBe('이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다. 한 번 끈 운영 조건은 다시 켤 수 없습니다. 다시 쓰려면 새로 추가해 주세요.');
  });
});

describe('패널', () => {
  const rows = [policy, { ...policy, id: '00000000-0000-4000-8000-000000042303', method: 'pickup' as const, state: 'draft' as const, activatedAt: null },
    { ...policy, id: '00000000-0000-4000-8000-000000042304', method: 'freight' as const, state: 'stopped' as const, stoppedAt: '2026-11-05T00:00:00Z' }];
  async function open(props: Partial<Parameters<typeof DeliveryPoliciesPanel>[0]> = {}) {
    mocks.read.mockResolvedValue({ ok: true, policies: rows }); mount(() => DeliveryPoliciesPanel({ originId: origin, canEdit: true, ...props })); effects(); await flush(); return render();
  }
  it("상태를 '준비 중 · 사용 · 사용 안 함'으로 보이고 내부 버전 번호를 보이지 않으며, 주문받는 방식을 한 줄로 되읽는다", async () => {
    const tree = await open(); const shown = text(tree);
    expect(all(tree).filter(node => node.type === 'details')).toHaveLength(4);
    for (const label of ['퀵 사용', '방문수령 준비 중', '화물배송 사용 안 함', '운영 조건 추가']) expect(shown).toContain(label);
    for (const gone of ['버전', '초안', '활성', '새 선택 중지', '근거', '정책']) expect(shown).not.toContain(gone);
    expect(shown).toContain('지금 이 출고지에서 주문받는 방식: 택배 · 퀵.'); expect(shown).toContain('고객이 주문서에서 그 방식을 골랐을 때 주문이 막힙니다.');
    const forms = all(tree).filter(node => node.type === DeliveryPolicyForm);
    expect(forms).toHaveLength(2); for (const item of forms) expect(item.props).toMatchObject({ activeMethods: ['quick'], runtime: true });
  });
  it('쇼핑몰 주문 설정이 꺼져 있으면 잠그지 않고, 주문서에서는 못 고르고 발송관리에서만 쓰인다고 말한다', async () => {
    mocks.runtime.mockResolvedValue(false); const tree = await open(); const shown = text(tree);
    expect(shown).toContain('지금 쇼핑몰 설정에서는 고객이 주문서에서 택배 외 방식을 고를 수 없습니다.'); expect(shown).toContain('퀵·방문수령·직접배송·화물배송은 켜 두면 발주(주문)확인/발송관리에서 주문의 배송 방식을 바꿀 때 쓰이고, 배송없음 · 직접전달은 쓸 수 없습니다.');
    expect(shown).toContain('개발 담당자에게 요청해 주세요.'); expect(shown).not.toContain('운영 설정을 확인'); expect(shown).not.toContain('지금 이 출고지에서 주문받는 방식');
    expect(all(tree).filter(node => node.type === DeliveryPolicyForm)).toHaveLength(2);
  });
  it('편집 권한이 없으면 폼을 열지 않고, 출고지 사용 여부를 폼에 넘긴다', async () => {
    const readonly = await open({ canEdit: false });
    expect(all(readonly).filter(node => node.type === DeliveryPolicyForm)).toHaveLength(0); expect(text(readonly)).toContain('운영 조건은 최고 관리자만 추가하고 켜고 끌 수 있습니다.');
    const tree = await open({ originActive: false });
    for (const item of all(tree).filter(node => node.type === DeliveryPolicyForm)) expect(item.props.originActive).toBe(false);
  });
  it('목록을 읽지 못하면 다시 불러오는 버튼 이름을 말한다', async () => {
    mocks.read.mockResolvedValue({ ok: false, error: '옛 문구' }); mount(() => DeliveryPoliciesPanel({ originId: origin, canEdit: true })); effects(); await flush();
    expect(text(render())).toContain('운영 조건을 불러오지 못했습니다. [다시 불러오기]를 눌러 주세요.'); expect(text(render())).not.toContain('옛 문구');
  });
});
