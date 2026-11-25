import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
/* 화면과 편집 창의 상태·ref 칸을 따로 둔다. 편집 창은 화면이 그린 요소를 함수로 다시 불러 그린다. */
const hooks = vi.hoisted(() => ({ scopes: {} as Record<string, unknown[]>, refs: {} as Record<string, { current: unknown }[]>, scope: 'screen', index: 0, refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), capture: vi.fn(), restore: vi.fn(), discard: vi.fn(), recovery: null as unknown, unavailable: false }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => undefined,
  useRef: (current: unknown) => { const refs = hooks.refs[hooks.scope] ??= []; const index = hooks.refIndex++; return refs[index] ??= { current }; },
  useState: (initial: unknown) => {
    const state = hooks.scopes[hooks.scope] ??= []; const index = hooks.index++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-size-chart-actions', () => ({ listGoodsSizeTemplatesAction: mocks.list, saveGoodsSizeTemplateAction: mocks.save }));
vi.mock('../useGoodsSizeRecovery', () => ({ useGoodsSizeRecovery: () => ({ recovery: mocks.recovery, invalidRecovery: false, unavailable: mocks.unavailable, capture: mocks.capture, restore: mocks.restore, discard: mocks.discard }) }));
import { GoodsSizeTemplatesScreen } from './GoodsSizeTemplatesScreen';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminPageHeader } from '../console/AdminKit';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { emptyGoodsSizeChart, type GoodsSizeChart, type GoodsSizeTemplate } from '@/lib/goods-size-chart';

type Element = ReactElement<{ children?: ReactNode; description?: string; onClick?: () => void; onClose?: () => void; onBlur?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; busy?: boolean; value?: string; open?: boolean }>;
const all = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';
const chart: GoodsSizeChart = { unit: 'cm', sizes: ['S'], measurements: [{ name: '총장', values: ['60'] }], note: '' };
const kept = { baseRevision: 0, name: '이전에 쓴 템플릿', chart, request: null };
const saved: GoodsSizeTemplate = { id: '93800000-0000-4000-8000-000000000601', name: '반팔 티셔츠', chart, revision: 3, archived: false, createdAt: '2026-10-13T14:00:00Z', updatedAt: '2026-10-14T14:00:00Z' };
const page = (rows: GoodsSizeTemplate[]) => ({ ok: true, value: { rows, total: rows.length, page: 1, pageSize: 20 } });

/** 화면의 편집 상태(`{ template }`)를 넣는다. 화면의 일곱 번째 상태 칸이다. */
const open = (template: GoodsSizeTemplate | null) => { hooks.scopes = { screen: Object.assign([], { 6: { template } }) }; hooks.refs = {}; };
/** 편집 창을 연 화면에서 편집 창을 그린다. */
function editor() {
  hooks.scope = 'screen'; hooks.index = 0; hooks.refIndex = 0;
  const host = all(GoodsSizeTemplatesScreen({ accountId: 'operator-a' })).find(node => typeof node.type === 'function' && node.type.name === 'SizeTemplateEditor');
  if (!host) throw new Error('SizeTemplateEditor');
  hooks.scope = 'editor'; hooks.index = 0; hooks.refIndex = 0;
  const render = host.type as (props: Element['props']) => ReactNode;
  return all(render(host.props));
}
function button(label: string) { const item = editor().find(node => node.type === Button && text(node) === label); if (!item) throw new Error(label); return item; }
const hasButton = (label: string) => editor().some(node => node.type === Button && text(node) === label);
const nameInput = () => editor().find(node => node.type === Input)!;
const fieldset = () => editor().find(node => node.type === 'fieldset')!;
const dialog = () => editor().find(node => node.type === CustomerServiceDialog)!;
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
let confirm: ReturnType<typeof stubAdminConfirm>;

beforeEach(() => {
  vi.clearAllMocks(); open(null); mocks.recovery = kept; mocks.unavailable = false;
  mocks.discard.mockImplementation(() => { mocks.recovery = null; });
  mocks.restore.mockImplementation(() => { mocks.recovery = null; return kept; });
  mocks.list.mockResolvedValue(page([]));
  confirm = stubAdminConfirm(true);
});
afterEach(() => { confirm.restore(); });

it('브라우저 복구 기록이 남은 동안 템플릿을 고치거나 저장해 이전 기록을 덮지 않는다', () => {
  expect(fieldset().props.disabled).toBe(true); expect(button('저장').props.disabled).toBe(true);
  expect(text(editor())).toContain('복구하거나 버린 뒤 템플릿을 고칠 수 있습니다.');
  nameInput().props.onChange?.({ target: { value: '새 이름' } });
  editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} });
  expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.discard).not.toHaveBeenCalled();
});

it('복구하면 이전 템플릿을, 버리면 빈 표를 이어서 고칠 수 있다', () => {
  button('템플릿 복구').props.onClick?.();
  expect(fieldset().props.disabled).toBe(false); expect(nameInput().props.value).toBe('이전에 쓴 템플릿');
  nameInput().props.onChange?.({ target: { value: '이어서 쓴 템플릿' } });
  expect(mocks.capture).toHaveBeenLastCalledWith({ baseRevision: 0, name: '이어서 쓴 템플릿', chart, request: null });
  open(null); mocks.recovery = kept; vi.clearAllMocks();
  mocks.discard.mockImplementation(() => { mocks.recovery = null; });
  button('복구 기록 버리기').props.onClick?.();
  expect(fieldset().props.disabled).toBe(false);
  nameInput().props.onChange?.({ target: { value: '새 템플릿' } });
  expect(mocks.capture).toHaveBeenLastCalledWith({ baseRevision: 0, name: '새 템플릿', chart: emptyGoodsSizeChart(), request: null });
});

describe('저장된 템플릿 고치기', () => {
  beforeEach(() => { open(saved); mocks.recovery = null; });

  it('[보관]은 보관 상태만 바꾼다 — 고친 이름은 보내지 않고, 고친 내용이 있으면 사라진다고 먼저 묻는다', async () => {
    mocks.save.mockResolvedValue({ ok: true, value: { ...saved, archived: true, revision: 4 } });
    nameInput().props.onChange?.({ target: { value: '고치던 이름' } });
    button('보관').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('[보관]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.');
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(saved.id, saved.name, saved.chart, true, 3, expect.any(String));
  });

  it('고친 내용이 없으면 묻지 않고 보관하고, 확인창에서 취소하면 보내지 않는다', async () => {
    mocks.save.mockResolvedValue({ ok: true, value: { ...saved, archived: true, revision: 4 } });
    button('보관').props.onClick?.(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(mocks.save).toHaveBeenCalledOnce();
    open(saved); vi.clearAllMocks(); confirm.restore(); confirm = stubAdminConfirm(false);
    nameInput().props.onChange?.({ target: { value: '고치던 이름' } });
    button('보관').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it('보관된 템플릿은 [복원]으로 되돌린다', async () => {
    open({ ...saved, archived: true });
    mocks.save.mockResolvedValue({ ok: true, value: { ...saved, revision: 4 } });
    expect(hasButton('보관')).toBe(false);
    button('복원').props.onClick?.(); await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(saved.id, saved.name, saved.chart, false, 3, expect.any(String));
  });

  it('다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다 — 최신 내용 위에 저장하면 최신 것을 기준으로 내 입력을 보낸다', async () => {
    const theirs = { ...saved, name: '다른 담당자 이름', revision: 5 };
    mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 작성한 표는 그대로 있습니다.' }).mockResolvedValueOnce({ ok: true, value: { ...theirs, name: '내가 고친 이름', revision: 6 } });
    mocks.list.mockResolvedValue(page([theirs]));
    nameInput().props.onChange?.({ target: { value: '내가 고친 이름' } });
    editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} }); await settle();
    expect(nameInput().props.value).toBe('내가 고친 이름'); expect(fieldset().props.disabled).toBe(false);
    const shown = text(editor());
    expect(shown).toContain('다른 사람이 먼저 바꿨습니다.'); expect(shown).toContain('지금 저장된 템플릿 · 다른 담당자 이름');
    expect(hasButton('저장')).toBe(false); expect(hasButton('보관')).toBe(false);
    for (const old of ['입력 보관하고 최신 목록 조회', '현재 템플릿 기준으로 표 유지', '현재 템플릿으로 바꾸기']) expect(hasButton(old)).toBe(false);
    button('최신 내용 위에 내 입력으로 저장').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual([saved.id, '내가 고친 이름', chart, false, 5, expect.any(String)]);
    expect(mocks.save.mock.calls[1][5]).not.toBe(mocks.save.mock.calls[0][5]);
  });

  it('[내 입력 버리기]는 확인한 뒤 보관해 둔 입력을 지우고 목록으로 돌아간다', async () => {
    mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 작성한 표는 그대로 있습니다.' });
    nameInput().props.onChange?.({ target: { value: '내가 고친 이름' } });
    editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} }); await settle();
    vi.clearAllMocks();
    button('내 입력 버리기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.');
    expect(mocks.discard).toHaveBeenCalledOnce();
    expect(hooks.scopes.screen[6]).toBeNull();
  });

  it('저장됐는지 모를 때는 같은 내용으로 다시 확인하고, 창은 확인을 거쳐 닫을 수 있다', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: '옛 문구' }).mockResolvedValueOnce({ ok: true, value: { ...saved, name: '고친 이름', revision: 4 } });
    nameInput().props.onChange?.({ target: { value: '고친 이름' } });
    editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} }); await settle();
    expect(text(editor())).toContain(SAVE_UNKNOWN_MESSAGE); expect(text(editor())).not.toContain('옛 문구');
    expect(fieldset().props.disabled).toBe(true); expect(dialog().props.busy).toBe(false); expect(button('닫기').props.disabled).toBe(false);
    button('저장됐는지 확인').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  });

  it('저장됐는지 모르는 채 닫을 때는 목록에서 확인하라고 묻는다', async () => {
    mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '옛 문구' });
    editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} }); await settle();
    dialog().props.onClose?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 같은 템플릿을 다시 열어 [저장됐는지 확인]을 눌러 주세요.');
    expect(hooks.scopes.screen[6]).toBeNull();
  });

  it('고친 표는 브라우저에 보관되므로 묻지 않고 닫고, 보관하지 못하는 브라우저에서만 사라진다고 묻는다', async () => {
    nameInput().props.onChange?.({ target: { value: '고치던 이름' } });
    button('닫기').props.onClick?.(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(hooks.scopes.screen[6]).toBeNull();
    open(saved); mocks.unavailable = true; confirm.restore(); confirm = stubAdminConfirm(false);
    nameInput().props.onChange?.({ target: { value: '고치던 이름' } });
    button('닫기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.'); expect(hooks.scopes.screen[6]).toEqual({ template: saved });
  });

  it('같은 이름의 다른 템플릿이 있으면 알리기만 하고 저장은 막지 않는다', async () => {
    mocks.list.mockResolvedValue(page([saved, { ...saved, id: '93800000-0000-4000-8000-000000000602' }]));
    nameInput().props.onBlur?.(); await settle();
    expect(mocks.list).toHaveBeenLastCalledWith('반팔 티셔츠', false, 1);
    expect(text(editor())).toContain('같은 이름의 템플릿이 이미 있습니다.'); expect(button('저장').props.disabled).toBe(false);
    nameInput().props.onChange?.({ target: { value: '반팔 티셔츠 (오버핏)' } });
    expect(text(editor())).not.toContain('같은 이름의 템플릿이 이미 있습니다.');
    mocks.list.mockResolvedValue(page([saved]));
    nameInput().props.onChange?.({ target: { value: '반팔 티셔츠' } }); nameInput().props.onBlur?.(); await settle();
    expect(text(editor())).not.toContain('같은 이름의 템플릿이 이미 있습니다.');
  });

  it('표가 다 채워지면 미리보기를 펼쳐 보이고, 편집 창에는 설명 문단을 두지 않는다', () => {
    expect(editor().find(node => node.type === 'details')?.props.open).toBe(true);
    expect(text(editor())).not.toMatch(/내부 이름으로 표를 찾아|이미 적용한 상품은|독립적으로 보존/);
  });
});

it('보관해 둔 뒤로 템플릿이 바뀌었으면 복구한 표를 그대로 둔 채 같은 두 길을 보인다', () => {
  open(saved); mocks.recovery = { ...kept, baseRevision: 2 };
  mocks.restore.mockImplementation(() => { mocks.recovery = null; return { ...kept, baseRevision: 2 }; });
  button('템플릿 복구').props.onClick?.();
  expect(nameInput().props.value).toBe('이전에 쓴 템플릿');
  expect(text(editor())).toContain('다른 사람이 먼저 바꿨습니다. 복구한 표는 그대로 있습니다.');
  expect(text(editor())).toContain('지금 저장된 템플릿 · 반팔 티셔츠');
  expect(hasButton('최신 내용 위에 내 입력으로 저장')).toBe(true); expect(hasButton('내 입력 버리기')).toBe(true);
});

describe('목록', () => {
  const screen = () => { hooks.scope = 'screen'; hooks.index = 0; hooks.refIndex = 0; return GoodsSizeTemplatesScreen({ accountId: 'operator-a' }); };
  it('고르는 창을 겸하지 않는다 — 줄 버튼은 [수정]뿐이고, 설명은 한 문장이다', () => {
    hooks.scopes = { screen: [{ rows: [saved], total: 1, page: 1, pageSize: 20 }] };
    const tree = all(screen());
    expect(tree.filter(node => node.type === Button).map(node => text(node))).toEqual(['초기화', '검색', '수정']);
    expect(tree.find(node => node.type === AdminPageHeader)?.props.description).toBe('템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다.');
  });
  it('빈 목록은 검색했는지·보관함인지에 맞춰 말한다', () => {
    const empty = { rows: [], total: 0, page: 1, pageSize: 20 };
    hooks.scopes = { screen: [empty] }; expect(text(screen())).toContain('등록된 사이즈 템플릿이 없습니다.');
    hooks.scopes = { screen: [empty, '', '티셔츠'] }; expect(text(screen())).toContain('조건에 맞는 템플릿이 없습니다.');
    hooks.scopes = { screen: [empty, '', '', true] }; expect(text(screen())).toContain('보관한 템플릿이 없습니다.');
  });
});
