import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { defaultShippingRegionPolicy, type ShippingRegionPolicy, type ShippingRegionPolicyInput } from '@/lib/admin/shipping-regions';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: false, jobs: [] as Promise<void>[] }));
const mocks = vi.hoisted(() => ({ apply: vi.fn(), save: vi.fn(), end: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'region',
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; hooks.jobs.push(action().finally(() => { hooks.pending = false; })); }],
}));
vi.mock('@/app/admin/shipping-region-actions', () => ({ applyShippingRegionPolicyAction: mocks.apply, saveShippingRegionPolicyAction: mocks.save,
  endShippingRegionPolicyAction: mocks.end, changeShippingRegionFeesAction: vi.fn() }));
import { ShippingRegionEditor, ShippingRegionFeeChanger } from './ShippingRegionsScreen';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { NativeSelect } from '../kit/ui/native-select';
import { Textarea } from '../kit/ui/textarea';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) =>
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((value) =>
  isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

const NOW = Date.parse('2026-11-26T03:00:00Z');
const originId = '00000000-0000-4000-8000-000000000001';
const origins = [{ id: originId, name: '김포', defaultCarrier: 'hanjin', baseFee: 3000, freeThreshold: 50000, active: true },
  { id: '00000000-0000-4000-8000-000000000002', name: '쉬는 창고', defaultCarrier: 'hanjin', baseFee: 3000, freeThreshold: null, active: false }];
const carriers = [{ code: 'hanjin', label: '한진택배', trackingUrlTemplate: '', active: true, updatedAt: '2026-09-10T00:00:00Z' }];
const TABLE = '63000\t63644\t\t제주\t추가배송비 받음\t4000';
const rules = [{ id: null, postalFrom: '63000', postalTo: '63644', addressPrefix: '', regionLabel: '제주', disposition: 'surcharge' as const, amount: 4000 }];
const saved = (patch: Partial<ShippingRegionPolicy> = {}): ShippingRegionPolicy => ({ ...defaultShippingRegionPolicy(originId, 'hanjin'), name: '기본 지역표', startsAt: '2026-09-10T00:00:00Z',
  rules: [{ ...rules[0], id: '00000000-0000-4000-8000-0000000000a1', amount: 3000 }], id: '00000000-0000-4000-8000-000000000101', version: 1, revision: 2, status: 'active',
  confirmedAt: '2026-09-10T00:00:00Z', confirmedBy: '관리자', updatedAt: '2026-09-10T00:00:00Z', ...patch });

const handlers = { onSaved: vi.fn(), onApplied: vi.fn(), onReplaced: vi.fn(), onPoliciesRefreshed: vi.fn(), onTouched: vi.fn() };
let props: { policy: ShippingRegionPolicy | null; initialCopy: ShippingRegionPolicyInput | null; policies: ShippingRegionPolicy[]; adoptions: { originId: string; managedFrom: string }[]; canEdit: boolean };
const render = () => { hooks.index = 0; return nodes(ShippingRegionEditor({ ...props, origins, carriers, now: NOW, ...handlers })); };
const button = (label: string) => render().find((node) => node.type === Button && text(node.props.children as ReactNode) === label);
const selects = () => render().filter((node) => node.type === NativeSelect);
const change = (node: Element, value: string) => (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const fill = () => { change(selects()[0], originId); change(render().filter((node) => node.type === Input)[0], '겨울 지역표'); change(render().find((node) => node.type === Textarea)!, TABLE); };
async function press(label: string) { await (button(label)!.props.onClick as () => Promise<void> | void)(); await Promise.all(hooks.jobs); }

let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => {
  hooks.values = []; hooks.jobs = []; hooks.pending = false; vi.resetAllMocks(); confirm = stubAdminConfirm(true);
  vi.useFakeTimers(); vi.setSystemTime(NOW + 60000);
  props = { policy: null, initialCopy: null, policies: [], adoptions: [], canEdit: true };
});
afterEach(() => { confirm.restore(); vi.useRealTimers(); });

describe('지역별 추가배송비를 한 번에 저장하고 적용하기', () => {
  it('쓰는 출고지만 고를 수 있고, 택배사는 출고지의 기본 택배사로 정해진다', () => {
    const options = nodes(selects()[0].props.children as ReactNode).filter((node) => node.type === 'option').map((node) => text(node.props.children as ReactNode));
    expect(options).toEqual(['골라 주세요', '김포']);
    change(selects()[0], originId);
    const page = text(render()[0]);
    expect(page).toContain('택배사: 한진택배 · 이 출고지의 기본 택배사로 적용합니다.');
    /* '출고지 정책 따름'은 상품의 배송비 유형 이름이라 그대로 쓴다. 그 밖에는 옛 낱말이 없다. */
    for (const removed of ['근거', '확인했습니다', '초안', '활성', '버전', '정책', '추가료']) expect(page.replaceAll('출고지 정책 따름', '')).not.toContain(removed);
  });

  it('빈 칸은 [저장하고 적용]을 눌렀을 때 알리고, 확인창도 서버도 부르지 않는다', async () => {
    expect(text(render()[0])).not.toContain('출고지를 골라 주세요.');
    await press('저장하고 적용');
    const page = text(render()[0]);
    for (const problem of ['출고지를 골라 주세요.', '이름을 적어 주세요.', '지역표를 붙여넣거나 ‘추가배송비를 받는 지역 없음’을 골라 주세요.']) expect(page).toContain(problem);
    expect(confirm).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('처음 쓰는 출고지: 확인창에 출고지·금액·적용 시작을 보이고, 확인하면 저장과 적용을 한 번에 보낸다', async () => {
    const applied = saved({ name: '겨울 지역표', startsAt: '2026-11-26T03:01:00Z' });
    mocks.apply.mockResolvedValue({ ok: true, policy: applied, replaced: [], message: '적용했습니다.' });
    fill();
    expect(text(render()[0])).toContain('‘출고지 정책 따름’ 상품: 기본 배송비 ₩3,000 + 추가배송비 ₩4,000 = ₩7,000');
    await press('저장하고 적용');
    expect(confirm).toHaveBeenCalledTimes(1);
    const message = confirm.mock.calls[0][0];
    for (const line of ['김포 · 한진택배 · 겨울 지역표', '추가배송비: 제주 ₩4,000', '적용 기간: 지금부터', '김포 출고지가 지역별 추가배송비를 쓰기 시작합니다.', '이미 들어온 주문의 배송비는 그대로입니다']) expect(message).toContain(line);
    expect(mocks.apply).toHaveBeenCalledWith(null, null, { ...defaultShippingRegionPolicy(originId, 'hanjin'), name: '겨울 지역표', rules }, [], true);
    expect(handlers.onApplied).toHaveBeenCalledWith(applied, [], '적용했습니다.');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('적용 중인 설정이 있으면 무엇으로 바뀌는지 보이고, 확인창에 보인 그 설정만 함께 바꾸라고 보낸다', async () => {
    const current = saved();
    props.policies = [current, saved({ id: '00000000-0000-4000-8000-000000000102', originId: origins[1].id })];
    props.adoptions = [{ originId, managedFrom: '2026-09-10T00:00:00Z' }];
    mocks.apply.mockResolvedValue({ ok: false, error: '적용 중인 설정이 방금 바뀌었습니다.', policies: [current] });
    fill();
    await press('저장하고 적용');
    const message = confirm.mock.calls[0][0];
    expect(message).toContain('지금 적용 중인 설정(기본 지역표)을 끝내고 이 내용으로 바꿉니다.');
    expect(message).toContain('금액이 바뀌는 지역: 제주 ₩3,000 → ₩4,000');
    expect(message).not.toContain('쓰기 시작합니다');
    expect(mocks.apply).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: '겨울 지역표', startsAt: null }), [current.id], true);
    /* 그 사이에 목록이 달라졌으면 적어 둔 내용은 그대로 두고 목록만 새로 받는다. */
    expect(handlers.onPoliciesRefreshed).toHaveBeenCalledWith([current]);
    expect(handlers.onApplied).not.toHaveBeenCalled();
    expect(text(render()[0])).toContain('적용 중인 설정이 방금 바뀌었습니다.');
    expect((render().find((node) => node.type === Textarea)!.props.value)).toBe(TABLE);
  });

  it('나중에 시작하게 하면 그 날짜를 보내고, 지금 설정이 언제까지 쓰이는지 말한다', async () => {
    const current = saved();
    props.policies = [current]; props.adoptions = [{ originId, managedFrom: '2026-09-10T00:00:00Z' }];
    mocks.apply.mockResolvedValue({ ok: true, policy: saved({ startsAt: '2026-11-30T15:00:00Z' }), replaced: [current], message: '저장했습니다.' });
    fill();
    change(selects()[1], 'date');
    change(render().find((node) => node.type === Input && node.props.type === 'datetime-local')!, '2026-12-01T00:00');
    await press('저장하고 적용');
    expect(confirm.mock.calls[0][0]).toContain('까지 적용하고, 그 뒤로 이 내용을 적용합니다.');
    expect(confirm.mock.calls[0][0]).not.toContain('지금부터 새 주문에 적용됩니다');
    expect(mocks.apply).toHaveBeenCalledWith(null, null, expect.objectContaining({ startsAt: '2026-11-30T15:00:00.000Z' }), [current.id], false);
  });

  it('확인창에서 돌아가면 아무것도 보내지 않는다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    fill();
    await press('저장하고 적용');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('[적용하지 않고 저장]은 빈 칸이 있어도 확인창 없이 저장만 한다', async () => {
    const draft = saved({ status: 'draft', startsAt: null, confirmedAt: null, confirmedBy: null });
    mocks.save.mockResolvedValue({ ok: true, policy: draft, message: '적용하지 않고 저장했습니다.' });
    change(selects()[0], originId);
    await press('적용하지 않고 저장');
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(null, null, { ...defaultShippingRegionPolicy(originId, 'hanjin'), rules: [] });
    expect(handlers.onSaved).toHaveBeenCalledWith(draft, '적용하지 않고 저장했습니다.');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('저장해 둔 설정은 근거를 그대로 들고 번호와 함께 적용한다', async () => {
    const draft = saved({ status: 'draft', revision: 4, startsAt: null, confirmedAt: null, confirmedBy: null, sourceEvidence: '사내 문서 12', chargeFreeGoods: null, openEnded: null });
    props.policy = draft; props.policies = [draft];
    mocks.apply.mockResolvedValue({ ok: true, policy: saved(), replaced: [], message: '적용했습니다.' });
    await press('저장하고 적용');
    expect(mocks.apply).toHaveBeenCalledWith(draft.id, 4, expect.objectContaining({ sourceEvidence: '사내 문서 12', chargeFreeGoods: true, openEnded: true, startsAt: null, carrierCode: 'hanjin' }), [], true);
  });

  it('적용 중인 설정은 고칠 수 없고, 끝내기는 주문이 막힌다는 것을 확인받은 뒤 보낸다', async () => {
    const current = saved();
    props.policy = current; props.policies = [current]; props.adoptions = [{ originId, managedFrom: '2026-09-10T00:00:00Z' }];
    mocks.end.mockResolvedValue({ ok: true, policy: { ...current, status: 'retired', revision: 3 }, message: '끝냈습니다.' });
    expect(button('저장하고 적용')).toBeUndefined();
    expect(render().some((node) => node.type === ShippingRegionFeeChanger && node.props.originName === '김포')).toBe(true);
    await press('끝내기');
    expect(confirm.mock.calls[0][0]).toContain('김포 출고지에 적용 중인 설정이 없어져 지금부터 새 주문이 막힙니다.');
    expect(mocks.end).toHaveBeenCalledWith(current.id, 2);
    expect(handlers.onSaved).toHaveBeenCalledWith({ ...current, status: 'retired', revision: 3 }, '끝냈습니다.');
  });

  it('조회만 하는 계정에는 저장·적용·끝내기 버튼이 없다', () => {
    props.policy = saved(); props.policies = [props.policy]; props.canEdit = false;
    for (const label of ['저장하고 적용', '적용하지 않고 저장', '끝내기']) expect(button(label)).toBeUndefined();
    expect(render().some((node) => node.type === ShippingRegionFeeChanger)).toBe(false);
  });
});
