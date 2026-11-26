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
  const sampleHint = () => find(render(), (element) => element.props.label === '확인용 운송장번호')?.props.hint;

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
  });
});
