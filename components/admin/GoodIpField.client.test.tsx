import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOD_EDITOR_B7_HELP } from '@/lib/admin/help/good-editor-b7';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));

import { AdminPickedBox } from './AdminPickedValue';
import { AdminField } from './console/AdminKit';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { GoodIpField, goodIpDisplayText, type GoodIpOption } from './GoodIpField';

type Props = { children?: ReactNode; href?: string; target?: string; rel?: string };
type BoxProps = Parameters<typeof AdminPickedBox>[0];
type FieldProps = Parameters<typeof AdminField>[0];
type DialogProps = AdminPickerPanelProps<GoodIpOption> & { title: string };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];

const options: GoodIpOption[] = [
  { id: 'hwasan', title: '화산강림', archivedAt: null },
  { id: 'old-ip', title: '옛 작품', archivedAt: '2026-10-01T00:00:00Z' },
  { id: 'lumen', title: '루멘 스토리', archivedAt: null },
];
let props: Partial<Parameters<typeof GoodIpField>[0]> = {};
/** 한 번 그리고 그 뒤의 effect까지 돌린다(커밋 뒤). */
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
  const tree = all(GoodIpField({ options, defaultValue: '', label: '연결 IP (필수)', ...props }));
  for (const effect of hooks.effects) effect();
  return tree;
}
const field = () => render().find((item) => item.type === AdminField) as unknown as ReactElement<FieldProps>;
const box = () => render().find((item) => item.type === AdminPickedBox) as unknown as ReactElement<BoxProps>;
const dialog = () => render().find((item) => item.type === AdminPickerDialog) as unknown as ReactElement<DialogProps> | undefined;
const link = () => render().find((item) => item.type === 'a');
const request = (query = '', page = 1) => ({ query, field: '', filter: '', page });

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; props = {}; });

describe('연결 IP 칸', () => {
  it('칸 이름 옆 "?"가 무엇인지 말하고, 칸 아래에 늘 보이는 안내는 없다', () => {
    expect(field().props).toMatchObject({ label: '연결 IP (필수)', help: GOOD_EDITOR_B7_HELP.connectedIp, inputId: 'good-ip-display' });
    expect(field().props.hint).toBeUndefined();
    expect(render().some((item) => item.type === 'p')).toBe(false);
  });

  it('고른 IP의 이름을 상자에 보이고 값은 숨은 칸 ipId로 제출한다', () => {
    expect(box().props).toMatchObject({ name: 'ipId', value: '', text: '', placeholder: '아직 고르지 않았습니다', pickLabel: 'IP 고르기', inputId: 'good-ip-display', locked: false, invalid: false });
    props = { defaultValue: 'hwasan' };
    hooks.state = [];
    expect(box().props).toMatchObject({ value: 'hwasan', text: '화산강림' });
  });

  it('오류는 칸 아래에 보이고 상자가 오류 상태가 된다', () => {
    props = { error: '연결 IP를 선택해주세요.' };
    expect(field().props.error).toBe('연결 IP를 선택해주세요.');
    expect(box().props.invalid).toBe(true);
  });

  it('보관한 IP가 이미 연결돼 있으면 이름과 보관됨만 보이고, 없는 IP는 내부 번호 대신 알 수 없는 IP로 보인다', () => {
    expect(goodIpDisplayText(options, 'old-ip')).toBe('보관됨 · 옛 작품');
    expect(goodIpDisplayText(options, 'hwasan')).toBe('화산강림');
    expect(goodIpDisplayText(options, '')).toBe('');
    expect(goodIpDisplayText(options, 'gone-ip-id')).toBe('알 수 없는 IP');
    props = { defaultValue: 'old-ip' };
    expect(box().props).toMatchObject({ value: 'old-ip', text: '보관됨 · 옛 작품' });
  });

  it('잠긴 상품(공개 중·그룹 공통정보)은 잠긴 상자로만 보이고 값은 그대로 제출한다', () => {
    props = { defaultValue: 'hwasan', locked: true, label: '연결 IP · 공개 중 잠금' };
    expect(field().props.label).toBe('연결 IP · 공개 중 잠금');
    expect(box().props).toMatchObject({ locked: true, name: 'ipId', value: 'hwasan', text: '화산강림' });
  });
});

describe('연결 IP 고르기 선택창', () => {
  const open = () => { box().props.onOpen(); return dialog()!.props; };

  it('[IP 고르기]가 공용 선택창을 열고 닫으면 닫힌다', () => {
    expect(dialog()).toBeUndefined();
    const picker = open();
    expect(picker).toMatchObject({ title: '연결 IP 고르기', searchPlaceholder: 'IP 이름으로 찾기', emptyText: '맞는 IP가 없습니다.' });
    expect(picker.selectLabel).toBeUndefined();
    picker.onClose();
    expect(dialog()).toBeUndefined();
  });

  it('보관한 IP는 목록에서 빼고 그렇게 알린다. 이름으로 찾는다', async () => {
    const picker = open();
    expect(picker.excludedNote).toBe('보관한 IP는 목록에서 뺐습니다.');
    const page = await picker.load(request());
    expect('rows' in page && page.rows.map((ip) => ip.id)).toEqual(['hwasan', 'lumen']);
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    const found = await picker.load(request('루멘'));
    expect('rows' in found && found.rows.map((ip) => ip.title)).toEqual(['루멘 스토리']);
    const archived = await picker.load(request('옛 작품'));
    expect(archived).toMatchObject({ total: 0 });
    expect(picker.rowKey(options[0])).toBe('hwasan');
    expect(picker.rowView(options[0])).toEqual({ title: '화산강림' });
  });

  it('보관한 IP가 없으면 뺐다는 안내를 두지 않는다', () => {
    props = { options: options.filter((ip) => !ip.archivedAt) };
    expect(open().excludedNote).toBeUndefined();
  });

  it('IP가 많으면 20개씩 나눠 보인다', async () => {
    props = { options: Array.from({ length: 45 }, (_, index) => ({ id: `ip-${index}`, title: `작품 ${index}`, archivedAt: null })) };
    const second = await open().load(request('', 3));
    expect(second).toMatchObject({ total: 45, page: 3, pageSize: 20 });
    expect('rows' in second && second.rows).toHaveLength(5);
  });

  it('고르면 상자와 숨은 칸이 바뀌고, 반영된 뒤 숨은 칸에서 input 이벤트가 나가 편집기가 새 값을 읽는다', () => {
    props = { defaultValue: 'hwasan' };
    const dispatchEvent = vi.fn();
    const first = box().props;
    (first.inputRef as { current: unknown }).current = { dispatchEvent };
    const picker = open();
    expect(picker.selectedKeys).toEqual(['hwasan']);
    expect(picker.onSelect(options[2])).toBeUndefined();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(box().props).toMatchObject({ value: 'lumen', text: '루멘 스토리' });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe('input');
    expect(dialog()!.props.selectedKeys).toEqual(['lumen']);
    /* 같은 IP를 다시 골라도 바뀐 것이 없어 다시 알리지 않는다. */
    dialog()!.props.onSelect(options[2]); render();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('아직 고르지 않았으면 선택됨 표시가 없다', () => {
    expect(open().selectedKeys).toBeUndefined();
  });
});

describe('IP 화면 열기', () => {
  it('IP 화면을 열 수 있는 운영자에게만, 고른 IP가 있을 때만 새 탭 링크를 둔다', () => {
    props = { defaultValue: 'hwasan' };
    expect(link()).toBeUndefined();
    props = { defaultValue: '', canOpenIp: true };
    hooks.state = [];
    expect(link()).toBeUndefined();
    props = { defaultValue: 'a b/c', canOpenIp: true };
    hooks.state = [];
    const anchor = link()!;
    expect(anchor.props).toMatchObject({ href: '/admin/catalog/ips/a%20b%2Fc', target: '_blank', rel: 'noreferrer' });
    expect(texts(anchor).join('')).toBe('IP 화면 열기 ↗');
  });

  it('잠긴 상품에서도 링크는 남는다(공개 중인 상품의 IP를 확인할 수 있게)', () => {
    props = { defaultValue: 'hwasan', canOpenIp: true, locked: true };
    expect(link()!.props.href).toBe('/admin/catalog/ips/hwasan');
  });
});
