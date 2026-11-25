import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTRY_NAME_SOURCE } from '@/lib/admin/country-names';
import { KOREAN_REGION_SOURCE } from '@/lib/admin/korean-regions';
import type { OriginChoice } from '@/lib/admin/origin-choices';

/* 부품을 함수로 불러 요소 트리를 걷는다. 훅은 순서대로 값을 보관하고, 효과는 처음 한 번만 돌려 정리 함수를 남긴다(언마운트 흉내). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => void)[], write: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useId: () => 'origin',
    useState: (initial: unknown) => {
      /* 값을 바꾸는 함수는 그릴 때의 보관함을 붙든다 — 선택창 본문을 따로 그릴 때(아래 panel) 늦게 온 조회 결과가 다른 보관함에 섞이지 않는다. */
      const index = hooks.index++, states = hooks.states;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
    useEffect: (effect: () => (() => void) | undefined) => { if (!hooks.effects.length) { const cleanup = effect(); if (cleanup) hooks.effects.push(cleanup); } },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { AdminPickerDialog, AdminPickerPanel, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { CountryNamePicker, GoodsOriginField } from './CountryNameFinder';

type Element = ReactElement<Record<string, unknown>>;
type PickerProps = AdminPickerPanelProps<OriginChoice> & { title: string };
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let props: Parameters<typeof CountryNamePicker>[0];
const apply = vi.fn(), close = vi.fn();
function render() { hooks.index = 0; hooks.refIndex = 0; return CountryNamePicker(props) as ReactElement<PickerProps>; }
/** 지금 선택창이 받는 props. */
const picker = () => render().props;
async function found(query = '', filter = '', page = 1) {
  const result = await picker().load({ query, field: '', filter, page });
  if ('error' in result) throw new Error(result.error);
  return result;
}
const row = async (query: string) => (await found(query)).rows[0];
/** 복사 모드에서 줄 오른쪽에 그리는 버튼. */
const copyButton = (target: OriginChoice, busy = false) => picker().rowAction!(target, { busy }) as Element;
const pressCopy = (target: OriginChoice) => { (copyButton(target).props.onClick as () => void)(); };
const footer = () => nodes(picker().footer);
async function settle(turns = 3) { for (let turn = 0; turn < turns; turn++) await Promise.resolve(); }
/** 선택창 본문의 훅 보관함. 원산지 창(CountryNamePicker)의 훅과 섞이지 않게 따로 둔다. */
type Store = { states: unknown[]; refs: { current: unknown }[]; effects: (() => void)[] };
/** 지금 props로 만든 선택창을 공용 선택창 본문(AdminPickerPanel)으로 실제로 그린다. */
function panel(store: Store) {
  const panelProps = picker();
  const outer: Store = { states: hooks.states, refs: hooks.refs, effects: hooks.effects };
  Object.assign(hooks, store, { index: 0, refIndex: 0 });
  try { return nodes(AdminPickerPanel(panelProps)); } finally { Object.assign(hooks, outer); }
}
/** 창을 열고 첫 쪽을 읽은 뒤의 본문. */
async function drawn() { const store: Store = { states: [], refs: [], effects: [] }; panel(store); await settle(12); return panel(store); }
const items = (all: Element[]) => nodes(all.find(node => node.type === 'ul')!.props.children as ReactNode).filter(node => node.type === 'li');
const buttonNames = (node: Element) => nodes(node.props.children as ReactNode).filter(item => item.type === 'button').map(item => text(item.props.children as ReactNode).trim());
beforeEach(() => {
  vi.clearAllMocks(); hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; hooks.effects = [];
  props = { mode: 'apply', currentValue: '', disabled: false, onApply: apply, onClose: close };
  apply.mockReturnValue(true); hooks.write.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: hooks.write } });
});
afterEach(() => vi.unstubAllGlobals());

describe('원산지 고르기 창', () => {
  it('공용 선택창에 국가·지역과 국내 지역을 한 목록으로 20개씩 보인다', async () => {
    expect(render().type).toBe(AdminPickerDialog);
    expect(picker()).toMatchObject({ title: '원산지 고르기', filterLabel: '범위', onClose: close });
    expect(picker().filterOptions!.map(option => option.label)).toEqual(['전체', '국가·지역', '국내 지역']);
    const first = await found();
    expect(first).toMatchObject({ total: 533, page: 1, pageSize: 20 });
    expect(first.rows).toHaveLength(20);
    expect(first.rows.every(item => item.kind === 'country')).toBe(true);
    expect((await found('', 'domestic')).total).toBe(284);
    expect((await found('', 'country')).total).toBe(249);
  });

  it('줄의 이름이 원산지 칸에 들어가는 글자이고 국가 코드는 보이지 않는다', async () => {
    const korea = await row('KOR');
    expect(picker().rowView(korea)).toEqual({ title: '대한민국', meta: 'South Korea' });
    expect(picker().rowKey(korea)).toBe('대한민국');
    const district = await row('수원 영통');
    expect(picker().rowView(district)).toEqual({ title: '대한민국(경기도 수원시 영통구)', meta: undefined });
    expect(picker().searchPlaceholder).not.toMatch(/KR|코드/);
  });

  it('[선택] 한 번으로 원산지 칸에 한국어 이름만 넣는다', async () => {
    expect(picker().rowAction).toBeUndefined();
    /* 선택창은 onSelect가 false를 돌려주지 않으면 스스로 닫는다. */
    expect(await picker().onSelect(await row('KOR'))).toBe(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith('대한민국');
    expect(picker().blockedReason).toBeNull();
  });

  it('국내 시·군·구도 같은 창에서 찾아 그 글자 그대로 넣는다', async () => {
    expect((await found('수원', 'domestic')).rows.map(item => item.value)).toContain('대한민국(경기도 수원시)');
    await picker().onSelect(await row('경기 김포'));
    expect(apply).toHaveBeenCalledExactlyOnceWith('대한민국(경기도 김포시)');
  });

  it('칸이 비어 있으면 한 문장만 보이고, 적힌 값이 있으면 무엇이 바뀌는지 보이며 같은 줄은 선택됨으로 둔다', () => {
    expect(text(picker().description)).toBe('고르면 원산지 칸에 들어갑니다.');
    expect(picker().selectedKeys).toBeUndefined();
    props = { ...props, currentValue: ' 중국 ' } as typeof props;
    expect(text(picker().description)).toBe("고르면 원산지 칸에 지금 적힌 '중국' 대신 들어갑니다.");
    expect(picker().selectedKeys).toEqual(['중국']);
    expect(picker().emptyText).toContain('원산지 칸에 직접 적어도 됩니다');
  });

  it('칸이 값을 받지 않으면 창을 닫지 않고 왜 못 바꾸는지 보인다', async () => {
    apply.mockReturnValue(false);
    expect(await picker().onSelect(await row('CN'))).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(picker().blockedReason).toBe('지금은 원산지를 바꿀 수 없습니다. 저장 중이면 끝난 뒤 다시 골라 주세요.');
    props = { ...props, blockedReason: '공개 중인 상품은 원산지를 바꿀 수 없습니다.' } as typeof props;
    expect(picker().blockedReason).toBe('공개 중인 상품은 원산지를 바꿀 수 없습니다.');
  });

  it('창이 열린 뒤 칸이 잠기면 선택창을 막고 받은 이유를 보인다', () => {
    props = { ...props, disabled: true } as typeof props;
    expect(picker().blockedReason).toBe('지금은 원산지를 바꿀 수 없습니다. 저장 중이면 끝난 뒤 다시 골라 주세요.');
    props = { ...props, blockedReason: '공개 중인 상품은 원산지를 바꿀 수 없습니다.' } as typeof props;
    expect(picker().blockedReason).toBe('공개 중인 상품은 원산지를 바꿀 수 없습니다.');
  });

  it('이름 자료의 출처와 라이선스를 창 아래에 잇고 자료 날짜는 보이지 않는다', () => {
    const links = footer().filter(node => node.type === 'a');
    expect(links.map(node => [text(node.props.children as ReactNode), node.props.href])).toEqual([
      ['국가·지역 이름: Unicode CLDR', COUNTRY_NAME_SOURCE.url], ['라이선스', COUNTRY_NAME_SOURCE.licenseUrl], ['국내 지역 이름: 국토교통부', KOREAN_REGION_SOURCE.url],
    ]);
    expect(links.every(node => node.props.target === '_blank' && node.props.rel === 'noreferrer')).toBe(true);
    expect(text(picker().footer)).not.toContain(KOREAN_REGION_SOURCE.version);
  });
});

describe('엑셀용 복사', () => {
  beforeEach(() => { props = { mode: 'copy', onClose: close }; });

  it('줄의 [복사]가 코드가 아닌 이름을 클립보드에 넣고, 창을 닫지 않은 채 무엇을 복사했는지 보인다', async () => {
    expect(picker().title).toBe('원산지 고르기');
    expect(text(picker().description)).toBe("원산지를 찾아 [복사]를 누른 뒤 엑셀의 '제조국' 열에 붙여 넣으세요.");
    expect(picker().blockedReason).toBeNull(); expect(picker().selectedKeys).toBeUndefined();
    const japan = await row('JP'), china = await row('CN');
    expect(copyButton(japan).props).toMatchObject({ type: 'button', disabled: false });
    expect(text(copyButton(japan).props.children as ReactNode)).toBe('복사');
    expect(copyButton(japan, true).props.disabled).toBe(true);
    pressCopy(japan); await settle();
    expect(hooks.write).toHaveBeenCalledExactlyOnceWith('일본');
    expect(text(copyButton(japan).props.children as ReactNode)).toBe('복사됨');
    expect(text(copyButton(china).props.children as ReactNode)).toBe('복사');
    expect(footer().find(node => node.props.role === 'status')).toBeTruthy();
    expect(text(picker().footer)).toContain('복사한 원산지: 일본');
    expect(close).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });

  it('국내 지역도 원산지 칸과 같은 글자로 복사한다', async () => {
    pressCopy(await row('수원 영통')); await settle();
    expect(hooks.write).toHaveBeenCalledExactlyOnceWith('대한민국(경기도 수원시 영통구)');
  });

  it('클립보드를 쓸 수 없으면 직접 복사할 글자를 남기고, 다시 눌러 성공하면 지운다', async () => {
    const japan = await row('JP'); hooks.write.mockRejectedValueOnce(new Error('denied'));
    pressCopy(japan); await settle();
    expect(text(footer().find(node => node.props.role === 'alert')!.props.children as ReactNode)).toBe('자동으로 복사하지 못했습니다. 아래 글자를 직접 복사해 주세요.');
    expect(footer().find(node => node.type === 'input')!.props).toMatchObject({ readOnly: true, value: '일본' });
    expect(text(copyButton(japan).props.children as ReactNode)).toBe('복사');
    pressCopy(japan); await settle();
    expect(footer().some(node => node.props.role === 'alert' || node.type === 'input')).toBe(false);
    expect(text(copyButton(japan).props.children as ReactNode)).toBe('복사됨');
  });

  it('복사가 끝나기 전에 다시 눌러도 한 번만 복사한다', async () => {
    const usa = await row('US');
    let finish!: () => void; hooks.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    pressCopy(usa); pressCopy(usa); expect(hooks.write).toHaveBeenCalledExactlyOnceWith('미국');
    finish(); await settle(); pressCopy(usa); await settle(); expect(hooks.write).toHaveBeenCalledTimes(2);
  });

  it('복사 중 창을 닫으면 늦은 응답으로 상태를 바꾸지 않는다', async () => {
    const usa = await row('US');
    let finish!: () => void; hooks.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    pressCopy(usa); hooks.effects[0](); const before = [...hooks.states]; finish(); await settle();
    expect(hooks.states).toEqual(before); expect(apply).not.toHaveBeenCalled();
  });
});

describe('선택창에 그려지는 모습', () => {
  it('적용: 줄마다 들어갈 글자와 [선택]이 있고, 칸에 지금 적힌 값의 줄은 선택됨이다', async () => {
    const [first, second] = (await found()).rows;
    props = { ...props, currentValue: first.value } as typeof props;
    const all = await drawn();
    expect(text(all.find(node => node.props.role === 'status')!.props.children as ReactNode)).toBe('검색 결과 533개');
    expect(items(all)).toHaveLength(20);
    expect(text(items(all)[0].props.children as ReactNode)).toBe(`${first.value}${first.english}선택됨`);
    expect(buttonNames(items(all)[0])).toEqual([]);
    expect(text(items(all)[1].props.children as ReactNode)).toBe(`${second.value}${second.english}선택`);
    expect(buttonNames(items(all)[1])).toEqual(['선택']);
    /* 줄에는 국가 코드가 없다. */
    expect(items(all).map(item => text(item.props.children as ReactNode)).join(' ')).not.toMatch(/\b[A-Z]{2,3} · [A-Z]{2,3}\b/);
    expect(all.filter(node => node.type === 'option').map(node => text(node.props.children as ReactNode))).toEqual(['전체', '국가·지역', '국내 지역']);
    expect(all.find(node => node.type === 'input' && node.props.type === 'search')!.props.placeholder).toBe('예: 중국, Vietnam, 수원');
  });

  it('복사: 줄마다 [선택] 대신 [복사]가 있다', async () => {
    props = { mode: 'copy', onClose: close };
    const all = await drawn();
    expect(items(all)).toHaveLength(20);
    expect(items(all).every(item => buttonNames(item).join() === '복사')).toBe(true);
    expect(all.some(node => node.props.role === 'alert')).toBe(false);
  });

  it('잠기면 이유를 보이고 검색과 [선택]을 모두 막는다', async () => {
    props = { ...props, disabled: true, blockedReason: '공개 중인 상품은 원산지를 바꿀 수 없습니다.' } as typeof props;
    const all = await drawn();
    expect(text(all.find(node => node.props.role === 'alert')!.props.children as ReactNode)).toBe('공개 중인 상품은 원산지를 바꿀 수 없습니다.');
    const buttons = all.filter(node => node.type === 'button');
    const named = (name: string) => buttons.filter(node => text(node.props.children as ReactNode).trim() === name);
    expect(named('선택')).toHaveLength(20); expect(named('검색')).toHaveLength(1);
    expect([...named('선택'), ...named('검색')].every(node => node.props.disabled === true)).toBe(true);
    expect(named('닫기').map(node => node.props.disabled)).toEqual([false]);
  });
});

describe('원산지 칸', () => {
  const field = Object.assign(new EventTarget(), { value: '직접 입력한 복수 원산지', readOnly: false, disabled: false });
  const nativeInput = vi.fn(), querySelector = vi.fn(() => field);
  let fieldProps: Parameters<typeof GoodsOriginField>[0];
  const renderField = () => { hooks.index = 0; hooks.refIndex = 0; return nodes(GoodsOriginField(fieldProps)); };
  const openButton = () => renderField().find(node => node.type === 'button')!;
  const opened = () => renderField().find(node => node.type === CountryNamePicker);
  const onApply = (name: string) => (opened()!.props.onApply as (value: string) => boolean)(name);
  beforeEach(() => {
    field.value = '직접 입력한 복수 원산지'; field.addEventListener('input', nativeInput);
    fieldProps = { defaultValue: '직접 입력한 복수 원산지', label: '원산지', readOnly: false, required: false, disabled: false };
    renderField(); hooks.refs[0].current = { querySelector };
  });
  afterEach(() => field.removeEventListener('input', nativeInput));

  it('직접 적는 입력을 그대로 두고, 옆의 아이콘 버튼이 원산지 고르기 창을 연다', () => {
    /* ADM-004(복잡도 표 209행): 고르기는 입력칸 바로 옆 아이콘 버튼이고 이름은 aria-label로 남는다. 입력은 지금처럼 자유 입력 noticeOrigin이다. */
    expect(renderField().find(node => node.type === 'input')!.props).toMatchObject({ name: 'noticeOrigin', defaultValue: '직접 입력한 복수 원산지', placeholder: '대한민국', readOnly: false });
    expect(openButton().props).toMatchObject({ 'aria-label': '원산지 고르기', title: '원산지 고르기', type: 'button', disabled: false, 'aria-haspopup': 'dialog' });
    expect(opened()).toBeUndefined();
    (openButton().props.onClick as () => void)();
    expect(opened()!.props).toMatchObject({ mode: 'apply', currentValue: '직접 입력한 복수 원산지', disabled: false });
    expect(opened()!.props.blockedReason).toBeUndefined();
    expect(field.value).toBe('직접 입력한 복수 원산지'); expect(nativeInput).not.toHaveBeenCalled();
    (opened()!.props.onClose as () => void)(); expect(opened()).toBeUndefined();
  });

  it('고르면 그 입력 하나에만 값을 넣고 input 이벤트를 한 번 보낸다 — 따로 알리는 글은 없다', () => {
    (openButton().props.onClick as () => void)();
    expect(onApply('대한민국')).toBe(true);
    expect(field.value).toBe('대한민국'); expect(nativeInput).toHaveBeenCalledOnce();
    expect(querySelector).toHaveBeenLastCalledWith('input[name="noticeOrigin"]');
    expect(renderField().some(node => node.props.role === 'status')).toBe(false);
  });

  it('공개 중 잠금이나 저장 중에는 버튼이 눌리지 않고, 열려 있던 창도 값을 넣지 않으며 잠긴 이유를 받는다', () => {
    (openButton().props.onClick as () => void)();
    fieldProps = { ...fieldProps, readOnly: true };
    expect(openButton().props.disabled).toBe(true);
    expect(opened()!.props).toMatchObject({ disabled: true, blockedReason: '공개 중인 상품은 원산지를 바꿀 수 없습니다. [초안으로 전환 후 수정]을 누른 뒤 바꿔 주세요.' });
    expect(onApply('일본')).toBe(false);
    fieldProps = { ...fieldProps, readOnly: false, disabled: true };
    expect(openButton().props.disabled).toBe(true);
    expect(opened()!.props.disabled).toBe(true); expect(opened()!.props.blockedReason).toBeUndefined();
    expect(onApply('중국')).toBe(false);
    /* 화면은 풀렸는데 입력 자체가 읽기 전용이면(늦게 그려진 경우) 넣지 않는다. */
    fieldProps = { ...fieldProps, disabled: false }; field.readOnly = true;
    expect(onApply('베트남')).toBe(false); field.readOnly = false;
    expect(field.value).toBe('직접 입력한 복수 원산지'); expect(nativeInput).not.toHaveBeenCalled();
  });

  it('잠긴 칸에서는 버튼을 눌러도 창이 열리지 않는다', () => {
    fieldProps = { ...fieldProps, disabled: true };
    (openButton().props.onClick as () => void)();
    expect(opened()).toBeUndefined();
  });
});
