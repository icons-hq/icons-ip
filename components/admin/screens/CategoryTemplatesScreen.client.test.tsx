import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/category-template-actions', () => ({
  listCategoryTemplatesAction: mocks.list, saveCategoryTemplatesAction: mocks.save, loadRegisteredCategoryTemplateIdsAction: vi.fn(), loadUsableCategoryTemplatesAction: vi.fn(),
}));
import { CATEGORY_TEMPLATE_ALREADY_EXISTS, CATEGORY_TEMPLATE_LIST_FAILED, CATEGORY_TEMPLATE_UNCERTAIN } from '@/lib/admin/category-templates';
import { CategoryTemplateRegisterDialog, CategoryTemplatesScreen } from './CategoryTemplatesScreen';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
const id = '94700000-0000-4000-8000-000000000101', other = '94700000-0000-4000-8000-000000000102';
const row = { categoryId: id, code: 'stationery', name: '문구', path: ['문구'], usable: true, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z' };
const page = { rows: [row], total: 1, page: 1, pageSize: 20 };
/** 화면 상태의 순서(useState 호출 순서). 상태를 더할 때는 마지막에 둔다. */
const S = { data: 0, archived: 3, selected: 4, pending: 5, uncertain: 6, conflict: 7, message: 8, error: 9, registering: 10 } as const;
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { checked?: boolean; value?: string } }) => void; disabled?: boolean; value?: string; type?: string; role?: string; 'aria-label'?: string }>;
/* 목록 카드 머리 동작(ConsoleListCard actions)도 화면이 그리는 요소다. */
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { actions?: ReactNode }).actions), ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return CategoryTemplatesScreen({}); }
function button(label: string, from: ReactNode = render()) { const node = all(from).find(item => (item.type === 'button' || item.type === Button) && text(item) === label); if (!node) throw new Error(label); return node; }
function choose() { all(render()).find(item => item.type === 'input' && item.props['aria-label'] === '문구 선택')?.props.onChange?.({ target: { checked: true } }); }
/** 열려 있는 등록 창. 창 안의 저장 결과(status)와 버튼은 이 요소의 props로 받는다. */
function registerDialog() { return all(render()).find(item => item.type === CategoryTemplateRegisterDialog) as unknown as ReactElement<Parameters<typeof CategoryTemplateRegisterDialog>[0]> | undefined; }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = [page]; hooks.refs = []; hooks.effects = []; mocks.list.mockResolvedValue({ ok: true, value: page }); });
it('preserves uncertain selections and retries the identical operation without double submission', async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: [{ ...row, revision: 2, archived: true }] });
  choose(); button('선택 보관 1개').props.onClick?.(); button('선택 보관 1개').props.onClick?.(); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: '응답 불명' }); await settle();
  expect(button('선택 보관 1개').props.disabled).toBe(true);
  expect(all(render()).filter(item => item.type === 'input' && item.props.type === 'checkbox').every(item => item.props.disabled)).toBe(true);
  button('저장됐는지 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(hooks.state[S.selected]).toEqual([]);
});
it('keeps selection after a confirmed conflict until an explicit fresh read', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 변경' });
  choose(); button('선택 보관 1개').props.onClick?.(); await settle();
  expect(hooks.state[S.selected]).toEqual([id]); expect(button('선택 보관 1개').props.disabled).toBe(true);
  button('최신 목록 다시 조회').props.onClick?.(); await settle(); expect(hooks.state[S.selected]).toEqual([]);
});
it('registers every picked category in one save and reports them as registered, not restored', async () => {
  mocks.save.mockResolvedValue({ ok: true, value: [{ ...row, revision: 1 }, { ...row, categoryId: other, revision: 1 }] });
  button('자주 쓰는 카테고리 등록').props.onClick?.();
  registerDialog()!.props.onRegister([id, other]); await settle();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0]).toEqual([{ categoryId: id, revision: 0 }, { categoryId: other, revision: 0 }]);
  expect(mocks.save.mock.calls[0][1]).toBe(false);
  expect(hooks.state[S.message]).toBe('자주 쓰는 카테고리 2개를 등록했습니다.');
  expect(hooks.state[S.registering]).toBe(false);
  expect(registerDialog()).toBeUndefined();
});
/* 사람 눈 시험(2026-11-10): 이미 있는 카테고리를 다시 등록하면 '다른 저장 결과가 있습니다'만 나와 원인을 몰랐다. */
it('says the categories already exist when a new registration conflicts, and leaves the dialog and the screen usable', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다.' });
  button('자주 쓰는 카테고리 등록').props.onClick?.();
  registerDialog()!.props.onRegister([id]); await settle();
  expect(hooks.state[S.message]).toBe(CATEGORY_TEMPLATE_ALREADY_EXISTS);
  expect(hooks.state[S.error]).toBe(true);
  expect(hooks.state[S.conflict]).toBe(false);
  expect(hooks.state[S.registering]).toBe(true);
  expect(registerDialog()!.props.busy).toBe(false);
});
it('keeps the stale-list wording for an archive conflict', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다.' });
  choose(); button('선택 보관 1개').props.onClick?.(); await settle();
  expect(hooks.state[S.message]).toBe('다른 사람이 먼저 바꿨습니다.');
  expect(hooks.state[S.conflict]).toBe(true);
});
it('reports a restore from the archived list as restored', async () => {
  hooks.state[S.archived] = true;
  hooks.state[S.data] = { ...page, rows: [{ ...row, archived: true, revision: 2 }] };
  mocks.list.mockResolvedValue({ ok: true, value: hooks.state[S.data] });
  mocks.save.mockResolvedValue({ ok: true, value: [{ ...row, revision: 3 }] });
  choose(); button('선택 복원 1개').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[0][0]).toEqual([{ categoryId: id, revision: 2 }]);
  expect(mocks.save.mock.calls[0][1]).toBe(false);
  expect(hooks.state[S.message]).toBe('자주 쓰는 카테고리 1개를 복원했습니다.');
});
/* 화면 규칙 1: 등록 창은 공용 선택창을 쓴다. 창 안의 검색 목록을 따로 만들지 않는다. */
it('registers in the shared picker dialog and hands it the category tree', () => {
  expect(registerDialog()).toBeUndefined();
  button('자주 쓰는 카테고리 등록').props.onClick?.();
  const dialog = registerDialog()!;
  expect(dialog.props).toMatchObject({ busy: false, uncertain: false });
  expect(dialog.props.categories).toEqual([]);
});
/* 모달 뒤에 가려지지 않게: 저장 결과와 확인 버튼은 창이 열려 있으면 창 안에, 닫혀 있으면 목록 위에 한 번만 보인다. */
it('shows the save result and the check button inside the open dialog instead of behind it', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: CATEGORY_TEMPLATE_UNCERTAIN }).mockResolvedValueOnce({ ok: true, value: [{ ...row, revision: 1 }] });
  button('자주 쓰는 카테고리 등록').props.onClick?.();
  registerDialog()!.props.onRegister([id]); await settle();
  expect(hooks.state[S.uncertain]).toBe(true);
  const page_ = render();
  expect(text(page_)).not.toContain(CATEGORY_TEMPLATE_UNCERTAIN);
  expect(all(page_).some(item => item.type === Button && text(item) === '저장됐는지 확인')).toBe(false);
  const dialog = registerDialog()!;
  expect(dialog.props.uncertain).toBe(true);
  expect(text(dialog.props.status)).toContain(CATEGORY_TEMPLATE_UNCERTAIN);
  button('저장됐는지 확인', dialog.props.status).props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  expect(hooks.state[S.registering]).toBe(false);
  expect(hooks.state[S.uncertain]).toBe(false);
  expect(text(render())).toContain('자주 쓰는 카테고리 1개를 등록했습니다.');
});
it('does not open the registration dialog while the list is not ready', () => {
  hooks.state[S.data] = null;
  expect(button('자주 쓰는 카테고리 등록').props.disabled).toBe(true);
  hooks.state[S.data] = page;
  hooks.state[S.pending] = true;
  expect(button('자주 쓰는 카테고리 등록').props.disabled).toBe(true);
});
/* 낱말 표: 코드에는 이름표를 달고, 보관을 되돌리는 말은 복원이다. 지금 고를 수 없는 줄은 이유를 줄에 적는다. */
it('names the category code on each row and says why a row cannot be picked', () => {
  hooks.state[S.data] = { ...page, total: 2, rows: [row, { ...row, categoryId: other, code: 'old-notes', path: ['문구', '단종'], usable: false }] };
  const screen = text(render());
  expect(screen).toContain('카테고리 코드 stationery');
  expect(screen).toContain('카테고리 코드 old-notes · 보관했거나 하위 카테고리가 있습니다.');
  expect(screen.match(/고를 수 없음/g)).toHaveLength(1);
  expect(screen).not.toContain('사용 불가');
  expect(screen).toContain('등록일 (KST)');
  hooks.state[S.archived] = true;
  expect(button('선택 복원 0개').props.disabled).toBe(true);
});
it('guides an empty list to the register button by its name', () => {
  hooks.state[S.data] = { ...page, rows: [], total: 0 };
  expect(text(render())).toContain('자주 쓰는 카테고리가 없습니다. 오른쪽 위 [자주 쓰는 카테고리 등록]을 눌러 추가해주세요.');
});
/* T-05: 읽지 못했을 때 '조회 후에 관리할 수 있습니다.'처럼 다음 행동이 없는 줄을 두지 않는다. 한 줄로 이유와 할 일을 말한다. */
it('says once what to do when the first read fails', async () => {
  hooks.state = [];
  mocks.list.mockResolvedValue({ ok: false, error: CATEGORY_TEMPLATE_LIST_FAILED });
  render(); hooks.effects[0](); await settle();
  const screen = text(render());
  expect(hooks.state[S.message]).toBe(CATEGORY_TEMPLATE_LIST_FAILED);
  expect(screen.split(CATEGORY_TEMPLATE_LIST_FAILED)).toHaveLength(2);
  expect(screen).not.toContain('불러오는 중');
  expect(screen).not.toContain('조회 후에');
});
it('ignores an initial response that arrives after a newer archived-list search', async () => {
  hooks.state = []; let initial!: (value: unknown) => void;
  const archived = { ...page, rows: [{ ...row, archived: true, revision: 2 }] };
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: archived });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'select' || item.type === AdminSelect)?.props.onChange?.({ target: { value: 'archived' } }); await settle();
  initial({ ok: true, value: page }); await settle();
  expect(hooks.state[S.data]).toEqual(archived); expect(hooks.state[S.archived]).toBe(true);
});
