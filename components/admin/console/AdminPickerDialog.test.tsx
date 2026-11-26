import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPickerRequest } from '@/lib/admin/picker';

/* 부품을 함수로 불러 요소 트리를 걷는다(이 저장소의 화면 시험 방식). 훅은 순서대로 값을 보관하고, 효과는 처음 한 번만 돌린다. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => unknown)[], effectIndex: 0, mounted: new Set<number>() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useId: () => 'picker',
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
    useEffect: (effect: () => unknown) => { const index = hooks.effectIndex++; if (!hooks.mounted.has(index)) { hooks.mounted.add(index); hooks.effects.push(effect); } },
  };
});

import { AdminPickerPanel, type AdminPickerPanelProps } from './AdminPickerDialog';

type Photo = { id: string; name: string; url: string | null; uses: number };
type Element = ReactElement<Record<string, unknown>>;
const photos: Photo[] = [
  { id: 'a', name: '키링 앞면.png', url: 'https://cdn.example/a.webp', uses: 2 },
  { id: 'b', name: '키링 뒷면.png', url: 'https://cdn.example/b.webp', uses: 0 },
  { id: 'c', name: '미리보기 없는 사진', url: null, uses: 0 },
];
const load = vi.fn(), select = vi.fn(), close = vi.fn();
let props: AdminPickerPanelProps<Photo>;

function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effectIndex = 0; const tree = AdminPickerPanel(props); hooks.effects.splice(0).forEach(effect => effect()); return tree; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
/** 창을 열고 첫 페이지를 읽은 뒤의 모습. */
async function opened() { render(); await settle(); return nodes(render()); }
const list = (all: Element[]) => all.find(node => node.type === 'ul' && 'data-admin-picker-list' in node.props)!;
const rows = (all: Element[]) => nodes(list(all).props.children as ReactNode).filter(node => node.type === 'li');
const buttons = (node: Element) => nodes(node.props.children as ReactNode).filter(item => item.type === 'button');
const image = (node: Element) => nodes(node.props.children as ReactNode).find(item => item.type === 'img');

beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.mounted = new Set();
  load.mockImplementation(async (request: AdminPickerRequest) => ({ rows: photos, total: photos.length, page: request.page, pageSize: 20 }));
  props = { load, rowKey: photo => photo.id, rowView: photo => ({ title: photo.name, meta: photo.uses ? `연결 ${photo.uses}건` : undefined, imageUrl: photo.url }), onSelect: select, onClose: close };
});

describe('공용 선택창의 목록 모양', () => {
  it('기본은 줄 목록이다 — 사진 칸은 48px이고 격자 표시가 없다', async () => {
    props = { ...props, showImages: true };
    const all = await opened();
    expect(list(all).props).not.toHaveProperty('data-admin-picker-layout', 'grid');
    expect(String(list(all).props.className)).toContain('flex-col');
    expect(rows(all)).toHaveLength(3);
    expect(String(rows(all)[0].props.className)).toContain('grid-cols-[3rem_minmax(0,1fr)_auto]');
    expect(image(rows(all)[0])?.props).toMatchObject({ width: 48, height: 48, src: 'https://cdn.example/a.webp' });
    expect(text(buttons(rows(all)[0])[0].props.children as ReactNode)).toBe('선택');
  });

  it('줄 목록은 showImages를 주지 않으면 사진 칸이 없다', async () => {
    const all = await opened();
    expect(String(rows(all)[0].props.className)).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(image(rows(all)[0])).toBeUndefined();
  });

  /* 사진 보관함: 48px 줄 목록으로는 사진을 구분할 수 없어 사진을 크게 보이는 격자를 쓴다. */
  it('격자는 showImages 없이도 사진을 칸 너비로 크게 보이고 이름·보조 글·[선택]을 사진 아래에 둔다', async () => {
    props = { ...props, layout: 'grid' };
    const all = await opened();
    expect(list(all).props['data-admin-picker-layout']).toBe('grid');
    expect(String(list(all).props.className)).toContain('grid-cols-2');
    const [first, second, third] = rows(all);
    expect(image(first)?.props).toMatchObject({ src: 'https://cdn.example/a.webp', loading: 'lazy', alt: '' });
    expect(String(image(first)?.props.className)).toContain('aspect-square');
    /* 크기는 CSS가 정한다 — 고정 폭·높이 속성은 정사각 비율을 깨뜨린다. */
    expect(image(first)?.props).not.toHaveProperty('width');
    expect(image(first)?.props).not.toHaveProperty('height');
    expect(text(first.props.children as ReactNode)).toBe('키링 앞면.png연결 2건선택');
    expect(text(second.props.children as ReactNode)).toBe('키링 뒷면.png선택');
    /* 미리보기 주소가 없으면 같은 크기의 빈 칸을 둔다. */
    expect(image(third)).toBeUndefined();
    expect(nodes(third.props.children as ReactNode).some(node => node.type === 'span' && node.props['aria-hidden'] === 'true' && String(node.props.className).includes('aspect-square'))).toBe(true);
  });

  it('격자에서도 [선택]을 누르면 고른 줄을 넘기고 창을 닫는다', async () => {
    props = { ...props, layout: 'grid' };
    const all = await opened();
    (buttons(rows(all)[1])[0].props.onClick as () => void)();
    await settle();
    expect(select).toHaveBeenCalledExactlyOnceWith(photos[1]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('격자에서 여러 개 고르기: 고른 칸은 선택됨, 막힌 칸은 이유를 보이고, 고른 뒤에도 [완료]까지 닫지 않는다', async () => {
    props = { ...props, layout: 'grid', multiple: true, selectedKeys: ['a'], rowBlocked: photo => photo.id === 'c' ? '자리 없음' : null };
    const all = await opened();
    const [picked, free, blocked] = rows(all);
    expect(picked.props['data-picked']).toBe(true);
    expect(text(picked.props.children as ReactNode)).toContain('선택됨');
    expect(buttons(picked)).toHaveLength(0);
    expect(text(blocked.props.children as ReactNode)).toContain('자리 없음');
    expect(buttons(blocked)).toHaveLength(0);
    (buttons(free)[0].props.onClick as () => void)();
    await settle();
    expect(select).toHaveBeenCalledExactlyOnceWith(photos[1]);
    expect(close).not.toHaveBeenCalled();
    expect(nodes(render()).filter(node => node.type === 'button').map(node => text(node.props.children as ReactNode))).toContain('완료');
  });

  it('격자에서도 검색어는 [검색]을 눌러야 조회에 넘어가고 첫 페이지부터 읽는다', async () => {
    props = { ...props, layout: 'grid' };
    const all = await opened();
    expect(load).toHaveBeenCalledExactlyOnceWith({ query: '', field: '', filter: '', page: 1 });
    (all.find(node => node.type === 'input')!.props.onChange as (event: unknown) => void)({ target: { value: '키링' } });
    expect(load).toHaveBeenCalledOnce();
    const search = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '검색')!;
    (search.props.onClick as () => void)();
    await settle();
    expect(load).toHaveBeenLastCalledWith({ query: '키링', field: '', filter: '', page: 1 });
  });
});

/* 2026-11-25 리뷰 뒤에 더한 것. 모두 선택적 prop이고, 주지 않으면 예전 모양·동작 그대로다. */
describe('공용 선택창의 선택적 동작', () => {
  const buttonNamed = (name: string) => nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === name);
  const closeButton = (name: string) => { const found = buttonNamed(name); expect(found, name).toBeDefined(); return found!; };
  const query = (all: Element[]) => all.find(node => node.type === 'input' && node.props.type === 'search')!;
  const filter = () => nodes(render()).find(node => node.props.id === 'picker-filter')!;
  const filterOptions = [{ value: '', label: '저장한 항목' }, { value: 'archived', label: '삭제한 항목' }];

  it('여러 개 고르기의 닫는 버튼: 기본은 주 버튼 [완료]이고, 글자를 넘기면 그 글자의 보조 버튼이다', async () => {
    props = { ...props, multiple: true };
    await opened();
    expect(String(closeButton('완료').props.className)).toContain('bg-primary');
    /* footer에 개수·주의 글만 둔 창의 [완료]도 그대로 주 버튼이다. */
    props = { ...props, footer: '고른 상품 2개' };
    expect(String(closeButton('완료').props.className)).toContain('bg-primary');
    /* 주 동작([N개 등록])이 footer에 따로 있는 창은 글자를 넘겨 닫는 버튼을 보조 모양으로 둔다 — 주 버튼이 둘로 보이지 않는다. */
    props = { ...props, closeLabel: '닫기' };
    expect(buttonNamed('완료')).toBeUndefined();
    expect(String(closeButton('닫기').props.className)).not.toContain('bg-primary');
    (closeButton('닫기').props.onClick as () => void)();
    expect(close).toHaveBeenCalledOnce();
  });

  it('한 개 고르기의 [닫기]는 넘긴 글자와 상관없이 그대로다', async () => {
    props = { ...props, closeLabel: '끝내기' };
    await opened();
    expect(buttonNamed('끝내기')).toBeUndefined();
    expect(String(closeButton('닫기').props.className)).not.toContain('bg-primary');
  });

  it('조건을 바꾸면 [검색]을 누르지 않아도 첫 쪽부터 다시 조회하고, 적어 둔 검색어를 함께 넘긴다', async () => {
    props = { ...props, filterLabel: '보기', filterOptions };
    const all = await opened();
    expect(load).toHaveBeenCalledExactlyOnceWith({ query: '', field: '', filter: '', page: 1 });
    (query(all).props.onChange as (event: unknown) => void)({ target: { value: '키링' } });
    expect(load).toHaveBeenCalledOnce();
    (filter().props.onChange as (event: unknown) => void)({ target: { value: 'archived' } });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith({ query: '키링', field: '', filter: 'archived', page: 1 });
    expect(filter().props.value).toBe('archived');
    /* 같은 값을 다시 고르면 조회하지 않는다. */
    (filter().props.onChange as (event: unknown) => void)({ target: { value: 'archived' } });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    /* 쪽 이동과 [검색]은 바꾼 조건을 그대로 쓴다. */
    (buttonNamed('검색')!.props.onClick as () => void)();
    await settle();
    expect(load).toHaveBeenLastCalledWith({ query: '키링', field: '', filter: 'archived', page: 1 });
  });

  it('조건을 잇달아 바꾸면 가장 최근 조회만 목록에 반영한다', async () => {
    props = { ...props, filterLabel: '보기', filterOptions };
    await opened();
    let finishSlow!: (value: unknown) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finishSlow = resolve; }))
      .mockImplementationOnce(async (request: AdminPickerRequest) => ({ rows: [photos[1]], total: 1, page: request.page, pageSize: 20 }));
    (filter().props.onChange as (event: unknown) => void)({ target: { value: 'archived' } });
    (filter().props.onChange as (event: unknown) => void)({ target: { value: '' } });
    await settle();
    expect(load.mock.calls.map(([request]) => (request as AdminPickerRequest).filter)).toEqual(['', 'archived', '']);
    expect(rows(nodes(render()))).toHaveLength(1);
    /* 늦게 온 앞선 조회는 버린다. */
    finishSlow({ rows: photos, total: 3, page: 1, pageSize: 20 });
    await settle();
    expect(rows(nodes(render()))).toHaveLength(1);
    expect(filter().props.value).toBe('');
  });

  it('처음 검색어를 넘기면 검색어 칸에 넣어 두고 첫 조회도 그 검색어로 한다', async () => {
    props = { ...props, initialQuery: '아크릴 키링' };
    const all = await opened();
    expect(load).toHaveBeenCalledExactlyOnceWith({ query: '아크릴 키링', field: '', filter: '', page: 1 });
    expect(query(all).props.value).toBe('아크릴 키링');
    /* 쪽 이동도 같은 검색어를 쓴다(적용된 검색어가 처음 검색어에서 시작한다). */
    (query(all).props.onChange as (event: unknown) => void)({ target: { value: '스티커' } });
    (buttonNamed('검색')!.props.onClick as () => void)();
    await settle();
    expect(load).toHaveBeenLastCalledWith({ query: '스티커', field: '', filter: '', page: 1 });
  });

  it('고른 줄: 들어간 자리를 선택됨 대신 보이고, 뺄 수 없는 줄은 [빼기] 자리에 까닭을 적거나 버튼만 감춘다', async () => {
    const deselect = vi.fn();
    props = { ...props, multiple: true, selectedKeys: ['a', 'b', 'c'], onDeselect: deselect,
      selectedLabel: photo => photo.id === 'c' ? null : photo.id === 'a' ? '대표 이미지' : '추가 이미지 1',
      deselectBlocked: photo => photo.id === 'a' ? '공개 중이라 뺄 수 없음' : photo.id === 'c' ? '' : null };
    const [main, extra, kept] = rows(await opened());
    expect(text(main.props.children as ReactNode)).toBe('키링 앞면.png연결 2건대표 이미지공개 중이라 뺄 수 없음');
    expect(buttons(main)).toHaveLength(0);
    expect(text(extra.props.children as ReactNode)).toBe('키링 뒷면.png추가 이미지 1빼기');
    (buttons(extra)[0].props.onClick as () => void)();
    expect(deselect).toHaveBeenCalledExactlyOnceWith(photos[1]);
    /* 자리 이름을 돌려주지 않은 줄은 '선택됨'이고, 까닭이 빈 글자면 [빼기]만 없다. */
    expect(text(kept.props.children as ReactNode)).toBe('미리보기 없는 사진선택됨');
    expect(buttons(kept)).toHaveLength(0);
  });

  it('뺄 수 없는 줄을 따로 정하지 않으면 고른 줄마다 [빼기]가 있다(예전 그대로)', async () => {
    props = { ...props, multiple: true, selectedKeys: ['a'], onDeselect: vi.fn() };
    const [picked] = rows(await opened());
    expect(text(picked.props.children as ReactNode)).toBe('키링 앞면.png연결 2건선택됨빼기');
  });
});

