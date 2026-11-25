import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 수령 방식·주문 후 제작 패널의 동작(2026-11-25 리뷰 G6·S2). 패널 본문을 함수로 불러 요소 트리를 걷는다(훅은 순서대로 값을 보관한다).
 * 로그인 확인(ClaimContactSession)은 그리지 않고, 그 자식 함수에 계정과 범위를 직접 넘긴다.
 */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ readProduction: vi.fn(), saveProduction: vi.fn(), readFulfillment: vi.fn(), saveFulfillment: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useId: () => 'panel', useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/production-actions', () => ({ readGoodsProductionAction: mocks.readProduction, saveGoodsProductionAction: mocks.saveProduction }));
vi.mock('@/app/admin/goods-fulfillment-actions', () => ({ readGoodsFulfillmentAction: mocks.readFulfillment, saveGoodsFulfillmentAction: mocks.saveFulfillment, prepareDigitalAssetAction: vi.fn(), verifyDigitalAssetAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { GoodsFulfillmentDraftFields, GoodsFulfillmentPanel } from './GoodsFulfillmentPanel';
import { GoodsProductionPanel } from './GoodsProductionPanel';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

type Props = { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; disabled?: boolean; type?: string };
type Element = ReactElement<Props>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement<Props>(node) ? [node, ...all(node.props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

const identity = { expectedActorId: 'operator-1', expectedSessionId: 'session-1' };
const scope = { capture: () => ({}), canApply: () => true };
/** 패널(로그인 확인 → 본문)에서 본문만 그린다. */
function body(Panel: typeof GoodsProductionPanel | typeof GoodsFulfillmentPanel) {
  hooks.index = 0; hooks.refIndex = 0;
  const session = Panel({ goodId: 'good-1', accountId: 'operator-1' }) as ReactElement<{ children: (identity: unknown, scope: unknown) => ReactElement }>;
  const inner = session.props.children(identity, scope);
  return all((inner.type as (props: unknown) => ReactNode)(inner.props));
}
const button = (tree: Element[], label: string) => { const found = tree.find(node => node.type === 'button' && text(node) === label); if (!found) throw new Error(label); return found; };
const submit = (tree: Element[]) => tree.find(node => node.type === 'form')!.props.onSubmit!({ preventDefault() {} });

let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

describe('주문 후 제작 패널', () => {
  const policy = { version: 1, goodId: 'good-1', revision: 3, enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: '' };
  const READ = '현재 주문제작 설정 불러오기';
  const draft = () => hooks.state[1] as Record<string, unknown>;

  it('[현재 주문제작 설정 불러오기]는 적은 내용이 저장된 설정과 다를 때만 사라진다고 묻는다', async () => {
    mocks.readProduction.mockResolvedValue({ policy });
    button(body(GoodsProductionPanel), READ).props.onClick!(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(draft()).toMatchObject({ enabled: true, leadDays: '5' });
    /* 고친 것이 없으면 다시 불러와도 묻지 않는다. */
    button(body(GoodsProductionPanel), READ).props.onClick!(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(mocks.readProduction).toHaveBeenCalledTimes(2);
    hooks.state[1] = { ...draft(), leadDays: '9' };
    confirm.restore(); confirm = stubAdminConfirm(false);
    button(body(GoodsProductionPanel), READ).props.onClick!(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.');
    expect(mocks.readProduction).toHaveBeenCalledTimes(2); expect(draft().leadDays).toBe('9');
    confirm.restore(); confirm = stubAdminConfirm(true);
    button(body(GoodsProductionPanel), READ).props.onClick!(); await settle();
    expect(mocks.readProduction).toHaveBeenCalledTimes(3); expect(draft().leadDays).toBe('5');
  });

  /* S2: 결과를 모르던 저장을 다시 보냈는데 "다른 사람이 먼저 바꿨습니다"가 오면, 안내가 누르라고 하는 [현재 … 불러오기]를 누를 수 있어야 한다. */
  it('결과를 모르던 저장을 다시 보내 저장되지 않았다는 답을 받으면 잠금을 풀고 새 저장으로 다시 보낸다', async () => {
    mocks.readProduction.mockResolvedValue({ policy });
    button(body(GoodsProductionPanel), READ).props.onClick!(); await settle();
    mocks.saveProduction.mockRejectedValueOnce(new Error('offline'));
    submit(body(GoodsProductionPanel)); await settle();
    expect(button(body(GoodsProductionPanel), READ).props.disabled).toBe(true);
    expect(button(body(GoodsProductionPanel), '저장됐는지 확인').props.type).toBe('submit');
    const changed = '다른 사람이 먼저 바꿨습니다. [현재 주문제작 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.';
    mocks.saveProduction.mockResolvedValueOnce({ error: changed, uncertain: false });
    submit(body(GoodsProductionPanel)); await settle();
    expect(mocks.saveProduction.mock.calls[1][3]).toBe(mocks.saveProduction.mock.calls[0][3]);
    const tree = body(GoodsProductionPanel);
    expect(text(tree)).toContain(changed);
    expect(button(tree, READ).props.disabled).toBe(false);
    expect(tree.find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
    /* 다음 저장은 같은 저장을 되풀이하지 않는다. */
    mocks.saveProduction.mockResolvedValueOnce({ policy: { ...policy, revision: 4 } });
    expect(button(tree, '주문제작 설정 저장').props.type).toBe('submit');
    submit(tree); await settle();
    expect(mocks.saveProduction.mock.calls[2][3]).not.toBe(mocks.saveProduction.mock.calls[0][3]);
  });
});

describe('수령 방식 패널', () => {
  const file = { id: '99000000-0000-4000-8000-000000000901', name: '설명서.pdf', mimeType: 'application/pdf', size: 2048 };
  const settings = { version: 1, goodId: 'good-1', revision: 2, mode: 'shipping', methods: [{ method: 'parcel', feeAmount: null, feeBasis: 'per_order', installationFee: 0 }], files: [], publicNote: '' };
  const READ = '현재 배송·제공 설정 불러오기';
  const draft = () => hooks.state[1] as { publicNote: string; methods: { method: string; enabled: boolean; amount: string }[] };

  it('[현재 배송·제공 설정 불러오기]는 적은 내용이 저장된 설정과 다를 때만 사라진다고 묻는다', async () => {
    mocks.readFulfillment.mockResolvedValue({ settings });
    button(body(GoodsFulfillmentPanel), READ).props.onClick!(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(draft().methods.find(method => method.method === 'parcel')?.enabled).toBe(true);
    hooks.state[1] = { ...draft(), publicNote: '고치던 안내' };
    confirm.restore(); confirm = stubAdminConfirm(false);
    button(body(GoodsFulfillmentPanel), READ).props.onClick!(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.');
    expect(mocks.readFulfillment).toHaveBeenCalledOnce(); expect(draft().publicNote).toBe('고치던 안내');
  });

  /* S9: 받을 방식을 하나도 안 고른 것과 금액이 숫자가 아닌 것은 고치는 곳이 다르다. */
  it('저장하기 전에 받을 방식을 안 고른 것과 금액이 숫자가 아닌 것을 따로 말한다', async () => {
    mocks.readFulfillment.mockResolvedValue({ settings });
    button(body(GoodsFulfillmentPanel), READ).props.onClick!(); await settle();
    hooks.state[1] = { ...draft(), methods: draft().methods.map(method => ({ ...method, enabled: false })) };
    submit(body(GoodsFulfillmentPanel)); await settle();
    expect(text(body(GoodsFulfillmentPanel))).toContain('받을 방식을 하나 이상 골라 주세요.');
    hooks.state[1] = { ...draft(), methods: draft().methods.map(method => method.method === 'quick' ? { ...method, enabled: true, amount: '삼천' } : method) };
    submit(body(GoodsFulfillmentPanel)); await settle();
    expect(text(body(GoodsFulfillmentPanel))).toContain('선결제 배송비와 설치비는 0 이상의 숫자(원)로 적어 주세요.');
    expect(mocks.saveFulfillment).not.toHaveBeenCalled();
  });

  it('결과를 모르던 저장을 다시 보내 저장되지 않았다는 답을 받으면 잠금을 푼다', async () => {
    mocks.readFulfillment.mockResolvedValue({ settings });
    button(body(GoodsFulfillmentPanel), READ).props.onClick!(); await settle();
    mocks.saveFulfillment.mockRejectedValueOnce(new Error('offline'));
    submit(body(GoodsFulfillmentPanel)); await settle();
    expect(button(body(GoodsFulfillmentPanel), READ).props.disabled).toBe(true);
    mocks.saveFulfillment.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. [현재 배송·제공 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.', uncertain: false });
    submit(body(GoodsFulfillmentPanel)); await settle();
    expect(button(body(GoodsFulfillmentPanel), READ).props.disabled).toBe(false);
    expect(button(body(GoodsFulfillmentPanel), '배송·제공 설정 저장').props.type).toBe('submit');
  });

  /* G6: 뺀 파일을 다시 넣으려면 다시 올려야 한다. */
  it('[새 주문에서 제외]는 어떤 파일이 빠지는지 말하고 확인받은 뒤에만 뺀다', async () => {
    const onChange = vi.fn();
    const fields = () => all(GoodsFulfillmentDraftFields({ draft: { mode: 'digital', methods: [], files: [file], publicNote: '' } as never, onChange, onUpload: vi.fn(), fieldId: 'f' }));
    confirm.restore(); confirm = stubAdminConfirm(false);
    button(fields(), '새 주문에서 제외').props.onClick!(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('저장하면 새 주문부터 이 파일을 받을 수 없습니다. 이미 받은 주문은 그대로입니다. 다시 넣으려면 파일을 다시 올려야 합니다.');
    expect(onChange).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubAdminConfirm(true);
    button(fields(), '새 주문에서 제외').props.onClick!(); await settle();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ files: [] }));
  });
});
