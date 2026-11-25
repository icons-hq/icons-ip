import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[], tasks: [] as Promise<unknown>[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useTransition: () => [false, (task: () => unknown) => { hooks.tasks.push(Promise.resolve(task())); }],
}));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
vi.mock('./GoodsGroupOperation', () => ({
  GroupTable: ({ children }: { children: ReactNode }) => children,
  useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: vi.fn() }),
}));
vi.mock('./screens/CustomerServiceDialog', () => ({ CustomerServiceDialog: ({ children }: { children: ReactNode }) => children }));

import Link from 'next/link';
import type { GoodsBulkCommand, GoodsBulkFormFields, GoodsBulkGood, GoodsBulkPreview, GoodsBulkRequest } from '@/lib/admin/goods-bulk';
import { AdminNotice } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { GoodsBulkForm, GoodsBulkPreviewTable, GoodsBulkSkippedList, GoodsBulkToolbar } from './GoodsBulkToolbar';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
const isButton = (node: Element) => node.type === 'button' || node.type === Button;
const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const completed = vi.fn();

function render(selectedIds: string[]) {
  hooks.index = 0; hooks.refIndex = 0; hooks.effects = [];
  return GoodsBulkToolbar({ kind: 'goods', identity, selectedIds, onCompleted: completed, selectionActions: <span>마케팅 링크 생성/복사</span> });
}
/* 진행 기록 확인을 끝낸 뒤의 화면 — 그 전에는 막대 전체가 잠겨 있다. */
async function settled(selectedIds: string[]) {
  render(selectedIds);
  for (const effect of hooks.effects) effect();
  await Promise.resolve();
  return render(selectedIds);
}
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); while (hooks.tasks.length) { await hooks.tasks.shift(); await new Promise(resolve => setTimeout(resolve, 0)); } }
const labels = (list: Element[]) => list.filter(isButton).map(node => text(node.props.children as ReactNode));
const button = (list: Element[], label: string) => list.find(node => isButton(node) && text(node.props.children as ReactNode) === label)!;
const click = (list: Element[], label: string) => (button(list, label).props.onClick as () => void)();
const form = (list: Element[]) => list.find(node => node.type === GoodsBulkForm)!.props as {
  command: GoodsBulkCommand; fields: GoodsBulkFormFields; onCommand: (command: GoodsBulkCommand) => void; onFields: (patch: Partial<GoodsBulkFormFields>) => void; onSubmit: () => void;
};
const good = (id: string, patch: Partial<GoodsBulkGood> = {}): GoodsBulkGood => ({ id, name: `상품 ${id}`, code: id.toUpperCase(), price: 1000, nextPrice: 1000, priceMin: 1000, priceMax: 1000,
  nextMin: 1000, nextMax: 1000, published: false, archived: false, stopped: false, skip: null, ...patch });
const ready = (operationId: string, request: GoodsBulkRequest, goods: GoodsBulkGood[]): { value: GoodsBulkPreview } => ({ value: { state: 'ready', operationId, request, groups: [], goods, expiresAt: '2026-11-26T00:15:00Z' } });

beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.refs = []; hooks.tasks = [];
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return store.size; }, key: (index: number) => [...store.keys()][index] ?? null, getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

it('자주 쓰는 일괄 변경만 줄에 두고 나머지는 더보기에 둔다 — 마케팅 링크는 일괄 변경 뒤에 따로 선다', async () => {
  const tree = await settled(['good-a']);
  const all = nodes(tree);
  const menu = all.find(node => node.type === 'details')!;
  const inMenu = nodes(menu.props.children as ReactNode);
  expect(labels(inMenu)).toEqual(['판매기간 변경', '보관', '복원']);
  expect(labels(all).filter(label => !labels(inMenu).includes(label))).toEqual(['전시상태 변경', '판매상태 변경', '판매가 변경', '기간 할인']);
  expect(inMenu.some(node => node.type === Link && text(node.props.children as ReactNode) === '배송 변경')).toBe(true);
  expect(text(tree).indexOf('기간 할인')).toBeLessThan(text(tree).indexOf('마케팅 링크 생성/복사'));
});

it('더보기의 항목도 줄의 버튼과 같은 변경 창을 연다', async () => {
  click(nodes(await settled(['good-a'])), '보관');
  expect(nodes(render(['good-a'])).find(node => node.type === CustomerServiceDialog)?.props.title).toBe('보관');
});

it('선택이 없으면 더보기도 다른 버튼처럼 비활성이다', async () => {
  const all = nodes(await settled([]));
  expect(all.some(node => node.type === 'details')).toBe(false);
  const more = all.find(node => isButton(node) && text(node.props.children as ReactNode) === '더보기')!;
  expect(more.props.disabled).toBe(true);
});

/* B-04: 반대 동작을 드롭다운에 숨기지 않는다 — 버튼 이름은 묶음(전시상태·판매상태·기간 할인)이고, 창 첫 줄에서 방향을 고른다. */
it('묶음 버튼은 묶음 이름의 창을 열고, 창 안에서 고른 방향으로 바꾼다', async () => {
  click(nodes(await settled(['good-a'])), '전시상태 변경');
  let all = nodes(render(['good-a']));
  expect(all.find(node => node.type === CustomerServiceDialog)?.props.title).toBe('전시상태 변경');
  expect(form(all).command).toBe('publish');
  form(all).onCommand('unpublish');
  all = nodes(render(['good-a']));
  expect(form(all).command).toBe('unpublish');
  expect(all.find(node => node.type === CustomerServiceDialog)?.props.title).toBe('전시상태 변경');
  expect(text(render(['good-a']))).toContain('고른 상품 1개');
});

/* B-02·B-09: 틀린 칸은 서버로 보내지 않고 어느 칸인지 말한다. 입력값은 창이 들고 있어 [다시 입력]으로 돌아와도 남는다. */
it('입력이 틀리면 보내지 않고 어느 칸이 문제인지 알리며, 확인한 뒤 [다시 입력]으로 돌아와도 적은 값이 남는다', async () => {
  click(nodes(await settled(['good-a'])), '판매기간 변경');
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(text(render(['good-a']))).toContain('시작 (KST)과 종료 (KST)를 모두 입력해주세요.');
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a')]));
  form(nodes(render(['good-a']))).onFields({ startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' });
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  expect(mocks.preview.mock.calls[0][1]).toEqual({ kind: 'goods', ids: ['good-a'], command: 'period', values: { startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-07T14:59:00.000Z' } });
  click(nodes(render(['good-a'])), '다시 입력');
  expect(form(nodes(render(['good-a']))).fields).toMatchObject({ periodMode: 'range', startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' });
  /* '기간 없이 계속 판매'를 고르면 적어 둔 날짜를 읽지 않는다 — 두 선택이 함께 열려 날짜가 말없이 버려지지 않는다. */
  form(nodes(render(['good-a']))).onFields({ periodMode: 'none' });
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  expect(mocks.preview.mock.calls[1][1]).toMatchObject({ command: 'period', values: { startsAt: null, endsAt: null } });
});

/* D4: 막힌 상품만 건너뛰고 나머지를 저장한다. 건너뛴 상품과 이유는 저장 전 표와 저장 뒤 목록에 모두 남는다. */
it('건너뛸 상품이 섞여도 나머지를 저장하고, 저장 뒤에도 건너뛴 상품과 이유를 보인다', async () => {
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a'), good('good-b', { skip: 'goods_category_required' })]));
  mocks.commit.mockImplementation(async (operationId: string) => ({ value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null,
    skipped: [{ id: 'good-b', name: '상품 good-b', code: 'GOOD-B', reason: 'goods_category_required' }] } }));
  click(nodes(await settled(['good-a', 'good-b'])), '전시상태 변경');
  form(nodes(render(['good-a', 'good-b']))).onSubmit();
  await flush();
  let all = nodes(render(['good-a', 'good-b']));
  expect(all.find(node => node.type === GoodsBulkPreviewTable)?.props.preview).toMatchObject({ request: { command: 'publish' } });
  expect(button(all, '변경사항 저장').props.disabled).toBe(true);
  (all.find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  all = nodes(render(['good-a', 'good-b']));
  expect(button(all, '변경사항 저장').props.disabled).toBe(false);
  click(all, '변경사항 저장');
  await flush();
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(mocks.preview.mock.calls[0][0], identity);
  const tree = render(['good-a', 'good-b']);
  /* 창이 닫힌 뒤에 남는 한 줄이라 무엇을 바꿨는지(공개로)를 앞에 붙인다. */
  expect(text(tree)).toContain('공개로 · 상품 1개를 바꿨습니다. 건너뛴 상품 1개는 아래에 있습니다.');
  expect(nodes(tree).find(node => node.type === GoodsBulkSkippedList)?.props).toMatchObject({ command: 'publish', skipped: [{ id: 'good-b', reason: 'goods_category_required' }] });
  expect(nodes(tree).some(node => node.type === CustomerServiceDialog)).toBe(false);
  expect(completed).toHaveBeenCalledTimes(1);
});

it('모두 건너뛰면 이유는 보여 주되 저장은 누를 수 없다', async () => {
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a', { skip: 'goods_publish_incomplete' })]));
  click(nodes(await settled(['good-a'])), '전시상태 변경');
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  const all = nodes(render(['good-a']));
  expect(all.some(node => node.type === GoodsBulkPreviewTable)).toBe(true);
  expect(all.some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
  expect(button(all, '변경사항 저장').props.disabled).toBe(true);
  expect(mocks.commit).not.toHaveBeenCalled();
});

/* B-06: 결과를 모를 때의 버튼과 문장은 어드민 공통 한 쌍이다. */
it('저장 응답이 끊기면 [저장됐는지 확인]·[그만두고 다시 하기]만 남기고, 확인하면 같은 변경을 다시 보내지 않는다', async () => {
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a')]));
  mocks.commit.mockRejectedValue(new Error('network'));
  click(nodes(await settled(['good-a'])), '판매상태 변경');
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  (nodes(render(['good-a'])).find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  click(nodes(render(['good-a'])), '변경사항 저장');
  await flush();
  const tree = render(['good-a']);
  /* 같은 두 문장을 상태 줄과 알림 상자에 두 번 적지 않는다 — 알림 상자(제목 + 한 줄)만 남는다. */
  const notice = nodes(tree).find(node => node.type === AdminNotice)!;
  expect(notice.props.title).toBe('저장됐는지 확인하지 못했습니다.');
  expect(text(notice.props.children as ReactNode)).toContain('[저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  expect(text(tree).split('같은 내용이 두 번 저장되지 않습니다.')).toHaveLength(2);
  expect(nodes(tree).filter(node => node.type === 'p' && node.props.role === 'status')).toHaveLength(0);
  expect(labels(nodes(tree))).toEqual(expect.arrayContaining(['저장됐는지 확인', '그만두고 다시 하기']));
  for (const stale of ['처리 결과 조회', '미처리 요청', '요청번호', '진행 기록']) expect(text(tree)).not.toContain(stale);
  const operationId = mocks.preview.mock.calls[0][0];
  mocks.read.mockResolvedValue({ value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null, skipped: [] } });
  click(nodes(tree), '저장됐는지 확인');
  await flush();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(operationId, identity, false);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  expect(text(render(['good-a']))).toContain('판매중으로 · 상품 1개를 바꿨습니다.');
});

/* 리뷰 7: 거절되면 아무것도 바뀌지 않았다. "다시 확인해주세요"라고 말하면서 창과 적어 둔 값을 없애지 않는다. */
it('저장이 거절되면 창과 적어 둔 금액·방식을 그대로 두고 입력 단계로 돌아가 이유를 창 안에 보인다', async () => {
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a', { nextPrice: 1500, nextMin: 1500, nextMax: 1500 })]));
  mocks.commit.mockImplementation(async (operationId: string) => ({ value: { state: 'rejected', operationId, goodsCount: 0, groupsCount: 0, error: 'goods_bulk_changed' } }));
  click(nodes(await settled(['good-a'])), '판매가 변경');
  form(nodes(render(['good-a']))).onFields({ mode: 'increase', value: '500' });
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  (nodes(render(['good-a'])).find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  click(nodes(render(['good-a'])), '변경사항 저장');
  await flush();
  const tree = render(['good-a']);
  const all = nodes(tree);
  /* 창은 열려 있고(제목은 입력 단계의 이름), 표 대신 입력이 다시 보이며, 적어 둔 값이 남아 있다. */
  expect(all.find(node => node.type === CustomerServiceDialog)?.props.title).toBe('판매가 변경');
  expect(all.some(node => node.type === GoodsBulkPreviewTable)).toBe(false);
  expect(form(all).fields).toMatchObject({ mode: 'increase', value: '500' });
  expect(text(tree)).toContain('확인한 뒤에 상품·옵션·재고가 바뀌어 아무것도 바꾸지 않았습니다. 지금 내용으로 다시 확인해주세요.');
  expect(text(tree)).not.toContain('바꿨습니다.');
  expect(completed).not.toHaveBeenCalled();
  expect(all.some(node => node.type === AdminNotice)).toBe(false);
  /* 그 자리에서 [변경 내용 확인]을 다시 누르면 같은 값으로 새로 확인한다. 확인 체크는 다시 받는다. */
  form(all).onSubmit();
  await flush();
  expect(mocks.preview).toHaveBeenCalledTimes(2);
  expect(mocks.preview.mock.calls[1][1]).toEqual(mocks.preview.mock.calls[0][1]);
  expect(mocks.preview.mock.calls[1][0]).not.toBe(mocks.preview.mock.calls[0][0]);
  const again = nodes(render(['good-a']));
  expect(again.some(node => node.type === GoodsBulkPreviewTable)).toBe(true);
  expect(button(again, '변경사항 저장').props.disabled).toBe(true);
});

/* 그만두기(sealed)는 저장하지 않기로 한 것이라 창을 닫는다. */
it('[그만두고 다시 하기]로 그만두면 창을 닫고 그만뒀다고 알린다', async () => {
  mocks.preview.mockImplementation(async (operationId: string, request: GoodsBulkRequest) => ready(operationId, request, [good('good-a')]));
  mocks.commit.mockRejectedValue(new Error('network'));
  click(nodes(await settled(['good-a'])), '판매상태 변경');
  form(nodes(render(['good-a']))).onSubmit();
  await flush();
  (nodes(render(['good-a'])).find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  click(nodes(render(['good-a'])), '변경사항 저장');
  await flush();
  const operationId = mocks.preview.mock.calls[0][0];
  mocks.read.mockResolvedValue({ value: { state: 'sealed', operationId, goodsCount: 0, groupsCount: 0, error: null } });
  click(nodes(render(['good-a'])), '그만두고 다시 하기');
  await flush();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(operationId, identity, true);
  const tree = render(['good-a']);
  expect(nodes(tree).some(node => node.type === CustomerServiceDialog)).toBe(false);
  expect(text(tree)).toContain('저장하지 않고 그만뒀습니다. 지금 내용으로 처음부터 다시 해주세요.');
});
