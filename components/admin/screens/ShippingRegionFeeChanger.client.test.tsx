import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { ShippingRegionPolicy, ShippingRegionRuleInput } from '@/lib/admin/shipping-regions';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: false, jobs: [] as Promise<void>[] }));
const mocks = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; hooks.jobs.push(action().finally(() => { hooks.pending = false; })); }],
}));
vi.mock('@/app/admin/shipping-region-actions', () => ({ changeShippingRegionFeesAction: mocks.change, saveShippingRegionPolicyAction: vi.fn(), applyShippingRegionPolicyAction: vi.fn(), endShippingRegionPolicyAction: vi.fn() }));
import { ShippingRegionFeeChanger } from './ShippingRegionsScreen';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) =>
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((value) =>
  isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const rule = (postalFrom: string, regionLabel: string, amount: number | null, disposition: ShippingRegionRuleInput['disposition'] = 'surcharge'): ShippingRegionRuleInput =>
  ({ id: null, postalFrom, postalTo: postalFrom, addressPrefix: '', regionLabel, disposition, amount });
const policy = {
  id: '00000000-0000-4000-8000-000000000101', originId: '00000000-0000-4000-8000-000000000001', carrierCode: 'epost', name: '합성 도서 정책',
  startsAt: '2026-11-26T01:55:00Z', endsAt: null, openEnded: true, sourceEvidence: 'TEST-ONLY', unlistedDisposition: 'standard', feeUnit: 'per_shipment',
  chargePolicyGoods: true, waivePolicyThreshold: false, chargeFreeGoods: true, chargeIndividualGoods: true, noRulesConfirmed: false,
  rules: [rule('10000', '합성 도서', 1000), rule('10001', '합성 도서', 1000), rule('20000', '합성 제주', 3000), rule('20001', '합성 제주', 5000), rule('30000', '합성 없음', null, 'standard')],
  version: 1, revision: 2, status: 'active', confirmedAt: '2026-11-26T01:56:00Z', confirmedBy: '관리자', updatedAt: '2026-11-26T01:56:00Z',
} satisfies ShippingRegionPolicy;
const onReplaced = vi.fn();
let originName: string | undefined;
const render = () => { hooks.index = 0; return nodes(ShippingRegionFeeChanger({ policy, originName, onReplaced })); };
const inputs = (tree: Element[]) => tree.filter((node) => node.type === Input);
const button = (tree: Element[]) => tree.find((node) => node.type === Button && text(node.props.children as ReactNode) === '금액 바꾸기')!;
const type = (index: number, value: string) => { (inputs(render())[index].props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); };
async function press() { await (button(render()).props.onClick as () => Promise<void>)(); await Promise.all(hooks.jobs); }

let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { hooks.values = []; hooks.jobs = []; hooks.pending = false; originName = undefined; vi.resetAllMocks(); confirm = stubAdminConfirm(true); });
afterEach(() => confirm.restore());

describe('적용 중인 설정의 추가배송비 금액 바꾸기', () => {
  it('지역명별 금액 칸을 지금 금액으로 채우고, 바뀐 금액이 없으면 누를 수 없다', () => {
    const tree = render();
    expect(inputs(tree).map((node) => node.props.value)).toEqual(['1000', '']);
    expect(text(tree[0])).toContain('합성 도서 · 지역표 2줄');
    expect(text(tree[0])).toContain('지금 ₩3,000~₩5,000');
    expect(text(tree[0])).not.toContain('합성 없음');
    expect(button(tree).props.disabled).toBe(true);
    type(0, '1000');
    expect(button(render()).props.disabled).toBe(true);
  });

  it('어느 출고지의 무엇을 얼마로 바꾸는지 확인창에 보이고, 확인하면 바뀐 지역명만 서버에 보낸다', async () => {
    const next = { ...policy, id: '00000000-0000-4000-8000-000000000102', version: 2, revision: 1 };
    mocks.change.mockResolvedValue({ ok: true, policy: next, message: '추가배송비를 바꿨습니다.' });
    originName = '합성 출고지';
    type(0, '3000');
    expect(button(render()).props.disabled).toBe(false);
    await press();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].split('\n')).toEqual(['합성 출고지 · 합성 도서 정책', '합성 도서 ₩1,000 → ₩3,000 (2줄)', '',
      '지금부터 새 주문에 적용됩니다. 아직 결제하지 않은 장바구니·주문서에도 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.']);
    expect(mocks.change).toHaveBeenCalledWith(policy.id, 2, { '합성 도서': 3000 });
    expect(onReplaced).toHaveBeenCalledWith(next, policy.id, '추가배송비를 바꿨습니다.');
  });

  it('금액이 여럿인 지역명은 새 금액을 적어야 보내고, 숫자가 아니면 막는다', async () => {
    type(1, '12a');
    let tree = render();
    expect(button(tree).props.disabled).toBe(true);
    expect(text(tree[0])).toContain('추가배송비는 0원부터 1,000,000원까지 원 단위 숫자로 적어 주세요.');
    type(1, '1000001');
    expect(button(render()).props.disabled).toBe(true);
    type(1, '4000');
    mocks.change.mockResolvedValue({ ok: false, error: '다른 사람이 먼저 바꿨습니다.' });
    await press();
    expect(mocks.change).toHaveBeenCalledWith(policy.id, 2, { '합성 제주': 4000 });
    tree = render();
    expect(text(tree[0])).toContain('다른 사람이 먼저 바꿨습니다.');
    expect(onReplaced).not.toHaveBeenCalled();
  });

  it('확인창에서 취소하면 아무것도 바꾸지 않는다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    type(0, '2000');
    await press();
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
