import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableCarrier } from '@/lib/admin/store-settings';

/*
 * 택배사 폼의 입력에 따라 바뀌는 글(이름 바꿈 알림·운송장 형식 되읽기·확인용 번호 판정). 정적 렌더로는 입력을 흉내 낼 수 없어,
 * 이 저장소의 다른 화면 시험처럼 react 훅을 순서대로 모의하고 폼을 함수로 불러 요소 트리를 읽는다.
 * 폼 안 훅의 순서가 바뀌면 이 시험이 먼저 깨진다 — ShippingCarrierForm: useState(이름). ShippingCarrierFormatForm: useState(고치는 중·종류·최소·최대·확인용 번호).
 */
const mocks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(mocks.states[index]) : next; }];
    },
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
  };
});
vi.mock('@/app/admin/store-settings-actions', () => ({ saveStoreSettingsAction: vi.fn(), saveShippingCarrierAction: vi.fn(), saveShippingCarrierFormatAction: vi.fn(), saveInquiryAutoRepliesAction: vi.fn() }));
vi.mock('../useAdminLeaveGuard', () => ({ useAdminLeaveGuard: () => ({ formRef: undefined, dirty: false }) }));
import { ShippingCarrierForm, ShippingCarrierFormatForm } from './StoreSettingsForm';
import { GoodReadback } from '../GoodEditorParts';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function find(node: ReactNode, test: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, test); if (found) return found; } return undefined; }
  if (!isValidElement(node)) return undefined;
  const element = node as Element;
  return test(element) ? element : find(element.props.children, test);
}
const hanjin: EditableCarrier = { code: 'hanjin', label: '한진택배', trackingUrlTemplate: 'https://carrier.example.test/{trackingNumber}', active: true, updatedAt: '2026-11-26T00:00:00Z', trackingNumberPattern: '^[0-9]{10,14}$', trackingNumberRule: '숫자 10~14자리' };

const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node as Element).props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

beforeEach(() => { mocks.states = []; mocks.index = 0; });

describe('이름을 바꿀 때의 알림 (C-4)', () => {
  const render = (carrier?: EditableCarrier) => { mocks.index = 0; return ShippingCarrierForm({ carrier, canEdit: true }) as Element; };
  const labelField = (tree: Element) => find(tree, (element) => element.props.label === '택배사 이름')!;
  const labelInput = (tree: Element) => find(tree, (element) => element.props.name === 'label')!;
  const type = (tree: Element, value: string) => (labelInput(tree).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });

  it('이름을 고치기 전에는 알리지 않고, 저장된 이름과 달라지면 한 줄로 알리고, 되돌리면 사라진다', () => {
    expect(labelField(render(hanjin)).props.hint).toBeUndefined();
    type(render(hanjin), '한진 택배');
    expect(labelField(render(hanjin)).props.hint).toBe('이름을 바꾸면 옛 이름으로 적은 창고 회신 줄은 등록되지 않습니다. 코드로 적은 줄은 그대로 등록됩니다.');
    type(render(hanjin), '한진택배');
    expect(labelField(render(hanjin)).props.hint).toBeUndefined();
  });
  it('새로 등록하는 택배사는 이름을 적어도 알리지 않는다', () => {
    type(render(), '새 택배');
    expect(labelField(render()).props.hint).toBeUndefined();
  });
});

describe('운송장 형식 고르기 (C-2)', () => {
  const render = (carrier: EditableCarrier = hanjin) => { mocks.index = 0; return ShippingCarrierFormatForm({ carrier, canEdit: true }) as Element; };
  const pick = (kind: string) => (find(render(), (element) => element.props.name === 'trackingNumberKind' && element.props.value === kind)!.props.onChange as () => void)();
  const type = (name: string, value: string) => (find(render(), (element) => element.props.name === name)!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  const readback = () => find(render(), (element) => element.type === GoodReadback)?.props.children;
  const sampleField = () => find(render(), (element) => element.props.label === '확인용 운송장번호 (필수)');
  const sampleHint = () => sampleField()?.props.hint;
  const lengthField = () => find(render(), (element) => element.props.label === '자리 수');

  it('저장된 형식에서 시작해, 종류와 자리 수를 고르면 한 줄로 되읽는다', () => {
    expect(readback()).toBe('한진택배 운송장번호는 숫자 10~14자리여야 등록됩니다.');
    pick('alnum');
    type('trackingNumberMin', '12');
    type('trackingNumberMax', '12');
    expect(readback()).toBe('한진택배 운송장번호는 영문·숫자 12자리여야 등록됩니다.');
  });
  it('자리 수가 맞지 않으면 되읽지 않고, 정하지 않음을 고르면 자리 수·확인용 번호 칸이 닫힌다', () => {
    type('trackingNumberMin', '14');
    type('trackingNumberMax', '10');
    expect(readback()).toBeUndefined();
    pick('none');
    expect(find(render(), (element) => element.props.name === 'trackingNumberMin')).toBeUndefined();
    expect(find(render(), (element) => element.props.name === 'trackingNumberSample')).toBeUndefined();
    expect(readback()).toBeUndefined();
  });
  /* S4-1: 자리 수를 거꾸로 적어도 되읽기 한 줄이 말없이 사라지지 않고, 까닭과 고칠 방법을 칸 아래에서 바로 말한다. */
  it('자리 수가 맞지 않으면 까닭과 고칠 방법을 자리 수 칸 아래에 바로 보인다', () => {
    expect(lengthField()?.props.error).toBeUndefined();
    type('trackingNumberMin', '12');
    type('trackingNumberMax', '10');
    expect(readback()).toBeUndefined();
    expect(lengthField()?.props.error).toBe('최소 자리 수가 최대보다 큽니다. 최소를 최대보다 작거나 같게 적어 주세요.');
    /* 두 입력칸이 그 오류를 가리키고 잘못된 값으로 표시된다. */
    for (const name of ['trackingNumberMin', 'trackingNumberMax']) {
      const input = find(render(), (element) => element.props.name === name)!;
      expect(input.props['aria-invalid']).toBe(true);
      expect(input.props['aria-describedby']).toMatch(/-error$/);
    }
    type('trackingNumberMax', '40');
    expect(lengthField()?.props.error).toBe('자리 수는 8~30 사이로 적어 주세요.');
    type('trackingNumberMax', '1a');
    expect(lengthField()?.props.error).toBe('자리 수는 숫자로 적어 주세요.');
    /* 적는 도중(한 칸이 빔)에는 말하지 않고, 바로잡으면 오류가 사라지고 되읽기가 돌아온다. */
    type('trackingNumberMax', '');
    expect(lengthField()?.props.error).toBeUndefined();
    type('trackingNumberMax', '14');
    expect(lengthField()?.props.error).toBeUndefined();
    expect(readback()).toBe('한진택배 운송장번호는 숫자 12~14자리여야 등록됩니다.');
    /* 정하지 않음을 고르면 자리 수 칸 자체가 없다. */
    type('trackingNumberMin', '14'); type('trackingNumberMax', '10');
    pick('none');
    expect(lengthField()).toBeUndefined();
  });
  /* S4-1: 확인용 번호는 필수다 — 칸 이름에 적고, 비운 채 저장하면 브라우저 기본 말풍선 대신 칸 아래의 앱 문구가 나온다(noValidate). */
  it('확인용 운송장번호는 (필수)로 적고, 폼은 브라우저 기본 말풍선을 쓰지 않는다', () => {
    expect(sampleField()).toBeDefined();
    expect(find(render(), (element) => element.props.label === '확인용 운송장번호')).toBeUndefined();
    const form = find(render(), (element) => element.type === 'form')!;
    expect(form.props.noValidate).toBe(true);
    /* 접근성 표시(필수 입력)는 그대로 둔다 — 말풍선만 끈다. */
    for (const name of ['trackingNumberMin', 'trackingNumberMax', 'trackingNumberSample']) expect(find(render(), (element) => element.props.name === name)!.props.required).toBe(true);
  });
  it('확인용 운송장번호를 넣으면 새 형식에 맞는지 바로 말하고, 지우면 안내로 돌아간다 — 저장 전에 보인다', () => {
    const guide = '실제 운송장번호 하나를 넣어 형식에 맞는지 확인합니다. 저장되지 않습니다.';
    expect(sampleHint()).toBe(guide);
    type('trackingNumberSample', '1234-5678-9012');
    expect(sampleHint()).toBe('이 번호는 형식에 맞습니다.');
    type('trackingNumberSample', '12345');
    expect(sampleHint()).toBe('이 번호는 형식에 맞지 않습니다.');
    type('trackingNumberSample', '');
    expect(sampleHint()).toBe(guide);
  });
  it('예전에 식을 직접 적은 형식은 안내 문구만 보이고, [형식 새로 정하기]를 누르면 고르는 화면이 열린다(그때는 숫자만·빈 자리 수에서 시작한다)', () => {
    const custom: EditableCarrier = { ...hanjin, trackingNumberPattern: '^(1Z[A-Z0-9]{16}|[0-9]{12})$', trackingNumberRule: '숫자 12자리 또는 1Z로 시작하는 18자리' };
    expect(find(render(custom), (element) => element.props.name === 'trackingNumberKind')).toBeUndefined();
    const open = find(render(custom), (element) => element.props.children === '형식 새로 정하기')!;
    (open.props.onClick as () => void)();
    const opened = render(custom);
    expect(find(opened, (element) => element.props.name === 'trackingNumberKind' && element.props.value === 'digits')?.props.defaultChecked).toBe(true);
    expect(find(opened, (element) => element.props.name === 'trackingNumberMin')?.props.value).toBe('');
    /* 누른 사람에게 저장하면 예전 형식이 사라진다는 것과 그만두는 길을 한 줄로 말한다. 이 화면의 형식(숫자만 등)을 쓰는 택배사에는 이 줄이 없다. */
    expect(text(opened)).toContain('지금은 직접 적은 형식(숫자 12자리 또는 1Z로 시작하는 18자리)을 쓰고 있습니다. 저장하면 이 화면에서 고른 형식으로 바뀌고 예전 형식은 없어집니다. 그만두려면 화면을 새로고침해 주세요.');
    mocks.states = [];
    expect(text(render())).not.toContain('지금은 직접 적은 형식(');
    expect(text(render())).toContain('모든 운송장 등록');
  });
});
