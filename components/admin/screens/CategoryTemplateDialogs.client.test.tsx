import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const actions = vi.hoisted(() => ({ usable: vi.fn(), registered: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/category-template-actions', () => ({
  listCategoryTemplatesAction: vi.fn(), saveCategoryTemplatesAction: vi.fn(), loadUsableCategoryTemplatesAction: actions.usable, loadRegisteredCategoryTemplateIdsAction: actions.registered,
}));
import type { AdminCategoryNode } from '@/lib/admin/category';
import { CATEGORY_TEMPLATE_LIST_FAILED, type CategoryTemplate, type RegistrableTemplateCategory } from '@/lib/admin/category-templates';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { AdminPickerRequest, AdminPickerResult } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerPanelProps } from '../console/AdminPickerDialog';
import { Button } from '../kit/ui/button';
import { CategoryTemplatePicker, CategoryTemplateRegisterDialog } from './CategoryTemplatesScreen';

type Fn = (...args: unknown[]) => unknown;
type El = ReactElement<{ children?: ReactNode; onClick?: Fn; disabled?: boolean; role?: string; ref?: { current: unknown }; 'aria-label'?: string }>;
const all = (node: ReactNode): El[] => Array.isArray(node) ? node.flatMap(all) : isValidElement<{ children?: ReactNode }>(node) ? [node as El, ...all(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const request = (patch: Partial<AdminPickerRequest> = {}): AdminPickerRequest => ({ query: '', field: '', filter: '', page: 1, ...patch });
const pageOf = (result: AdminPickerResult<unknown>) => { if ('error' in result) throw new Error(result.error); return result; };

beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); });

/* ───────── 고르는 창 ───────── */
describe('자주 쓰는 카테고리 고르기 창', () => {
  type Props = AdminPickerPanelProps<CategoryTemplate> & { title: string };
  const template = (index: number, path: string[] = ['굿즈', `분류${index}`]): CategoryTemplate => ({
    categoryId: `94700000-0000-4000-8000-${String(index).padStart(12, '0')}`, code: `code-${index}`, name: path.at(-1)!, path, usable: true, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z',
  });
  const onSelect = vi.fn(), onClose = vi.fn();
  /** 렌더할 때마다 같은 ref를 쓰므로 읽어 둔 목록이 이어진다(실제 창이 다시 그려질 때와 같다). */
  function dialog() { hooks.index = 0; hooks.refIndex = 0; return CategoryTemplatePicker({ onSelect, onClose }) as unknown as ReactElement<Props>; }
  const list = (count: number) => Array.from({ length: count }, (_, index) => template(index + 1));

  it('공용 선택창이고, 고를 수 없는 줄은 목록에서 뺐다고 한 줄로 알린다', () => {
    const element = dialog();
    expect(element.type).toBe(AdminPickerDialog);
    expect(element.props).toMatchObject({
      title: '자주 쓰는 카테고리 고르기',
      description: '고르면 대표 카테고리 칸에 채워집니다.',
      excludedNote: '보관했거나 하위 카테고리가 생겨 지금 고를 수 없는 카테고리는 목록에서 뺐습니다.',
      searchPlaceholder: '카테고리 이름이나 코드로 찾기',
    });
    expect(element.props.multiple).toBeUndefined();
    expect(element.props.onClose).toBe(onClose);
  });

  it('줄에는 경로와 이름표가 붙은 코드를 보이고, 고르면 그 줄을 그대로 건넨다', () => {
    const element = dialog(), row = template(1, ['리빙', '머그']);
    expect(element.props.rowKey(row)).toBe(row.categoryId);
    expect(element.props.rowView(row)).toEqual({ title: '리빙 > 머그', meta: '카테고리 코드 code-1' });
    element.props.onSelect(row);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(row);
  });

  it('창을 열 때 서버가 준 목록을 한 번만 읽고, 검색·쪽 이동은 읽어 둔 목록에서 자른다', async () => {
    actions.usable.mockResolvedValue({ ok: true, value: list(45) });
    const first = pageOf(await dialog().props.load(request()));
    expect(first).toMatchObject({ total: 45, page: 1, pageSize: 20 });
    expect(first.rows).toHaveLength(20);
    expect(pageOf(await dialog().props.load(request({ page: 3 }))).rows).toHaveLength(5);
    expect(pageOf(await dialog().props.load(request({ query: '분류7' }))).rows).toEqual([list(7)[6]]);
    expect(actions.usable).toHaveBeenCalledOnce();
  });

  it('경로·붙여 쓴 경로·코드로 찾고, 낱말은 순서와 상관없이 모두 있으면 걸린다', async () => {
    const rows = [template(1, ['리빙', '머그']), template(2, ['리빙', '컵']), template(3, ['문구', '머그컵'])];
    actions.usable.mockResolvedValue({ ok: true, value: rows });
    const ids = async (query: string) => pageOf(await dialog().props.load(request({ query }))).rows.map(row => (row as CategoryTemplate).code);
    expect(await ids('리빙 머그')).toEqual(['code-1']);
    expect(await ids('리빙>컵')).toEqual(['code-2']);
    expect(await ids('머그 문구')).toEqual(['code-3']);
    expect(await ids('CODE-2')).toEqual(['code-2']);
    expect(await ids('없는 분류')).toEqual([]);
  });

  it('읽지 못하면 이유를 알리고, 다음 [검색]에서 다시 읽는다', async () => {
    actions.usable.mockResolvedValueOnce({ ok: false, error: '상품 관리 권한이 필요합니다.' }).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, value: list(1) });
    expect(await dialog().props.load(request())).toEqual({ error: '상품 관리 권한이 필요합니다.' });
    expect(await dialog().props.load(request())).toEqual({ error: CATEGORY_TEMPLATE_LIST_FAILED });
    expect(pageOf(await dialog().props.load(request())).rows).toHaveLength(1);
    expect(actions.usable).toHaveBeenCalledTimes(3);
  });
});

/* ───────── 등록 창 ───────── */
describe('등록할 카테고리 고르기 창', () => {
  type Props = AdminPickerPanelProps<RegistrableTemplateCategory> & { title: string };
  type DialogProps = Parameters<typeof CategoryTemplateRegisterDialog>[0];
  const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra });
  const categories = [
    node('living', '리빙', null, { childCount: 2 }), node('mug', '머그', 'living'), node('cup', '컵', 'living'),
    node('paper', '문구', null, { childCount: 2 }), node('note', '노트', 'paper'), node('old', '단종', 'paper', { archivedAt: '2026-10-01T00:00:00Z' }),
    node('misc', '잡화', null),
  ];
  const onRegister = vi.fn(), onClose = vi.fn();
  let props: Partial<DialogProps> = {};
  function dialog() { hooks.index = 0; hooks.refIndex = 0; return CategoryTemplateRegisterDialog({ categories, busy: false, uncertain: false, status: null, onRegister, onClose, ...props }) as unknown as ReactElement<Props>; }
  const rowsOf = async (query = '') => pageOf(await dialog().props.load(request({ query }))).rows as RegistrableTemplateCategory[];
  const pick = (id: string, path = id) => dialog().props.onSelect({ id, path, code: id, text: id });
  const footer = () => all(dialog().props.footer);
  const registerButton = () => footer().find(item => item.type === Button && /등록/.test(text(item)) && !/빼기/.test(text(item)))!;
  const withPicks = (ids: string[]) => { for (const id of ids) pick(id); };
  let confirm: ReturnType<typeof stubAdminConfirm>;
  beforeEach(() => { props = {}; actions.registered.mockResolvedValue({ ok: true, value: ['cup'] }); confirm = stubAdminConfirm(true); });
  afterEach(() => { confirm.restore(); });

  it('공용 선택창이고 여러 개를 고른 뒤 한 번에 등록한다', () => {
    const element = dialog();
    expect(element.type).toBe(AdminPickerDialog);
    expect(element.props).toMatchObject({
      title: '등록할 카테고리 고르기', multiple: true, searchPlaceholder: '카테고리 이름이나 코드로 찾기', emptyText: '일치하는 카테고리가 없습니다.',
      excludedNote: '이미 등록한 카테고리, 하위 카테고리가 있는 카테고리, 보관한 카테고리는 목록에서 뺐습니다.',
      /* 창 아래 버튼은 고른 것을 넣고 닫는 [완료]가 아니다 — [N개 등록]을 눌러야 등록되므로 그냥 [닫기]다. */
      closeLabel: '닫기',
    });
  });

  it('목록에는 지금 쓸 수 있는 마지막 단계 카테고리 중 아직 등록하지 않은 것만 경로 순으로 나온다', async () => {
    expect((await rowsOf()).map(row => row.path)).toEqual(['리빙 > 머그', '문구 > 노트', '잡화']);
    expect(actions.registered).toHaveBeenCalledOnce();
  });

  it('등록한 카테고리를 읽은 뒤에는 다시 읽지 않고 검색과 쪽 이동을 한다', async () => {
    expect((await rowsOf('노트')).map(row => row.id)).toEqual(['note']);
    expect((await rowsOf('리빙>머그')).map(row => row.id)).toEqual(['mug']);
    expect((await rowsOf('컵')).map(row => row.id)).toEqual([]);
    expect(actions.registered).toHaveBeenCalledOnce();
  });

  it('읽지 못하면 이유를 알리고, 다음 [검색]에서 다시 읽는다', async () => {
    actions.registered.mockResolvedValueOnce({ ok: false, error: '자주 쓰는 카테고리가 너무 많아 목록을 만들지 못했습니다.' }).mockRejectedValueOnce(new Error('network'));
    expect(await dialog().props.load(request())).toEqual({ error: '자주 쓰는 카테고리가 너무 많아 목록을 만들지 못했습니다.' });
    expect(await dialog().props.load(request())).toEqual({ error: CATEGORY_TEMPLATE_LIST_FAILED });
    expect((await rowsOf()).length).toBe(3);
    expect(actions.registered).toHaveBeenCalledTimes(3);
  });

  it('줄에는 경로와 이름표가 붙은 코드를 보인다', () => {
    expect(dialog().props.rowView({ id: 'mug', path: '리빙 > 머그', code: 'code-mug', text: '' })).toEqual({ title: '리빙 > 머그', meta: '카테고리 코드 code-mug' });
  });

  it('고르면 고른 개수와 [N개 등록]이 바뀌고, 누르면 고른 순서대로 한 번에 건넨다', () => {
    expect(registerButton().props.disabled).toBe(true);
    expect(text(registerButton())).toBe('등록');
    expect(text(footer()[0])).toContain('고른 카테고리 0개');
    withPicks(['note', 'mug', 'note']);
    expect(dialog().props.selectedKeys).toEqual(['note', 'mug']);
    expect(text(footer()[0])).toContain('고른 카테고리 2개');
    expect(text(registerButton())).toBe('2개 등록');
    registerButton().props.onClick?.();
    expect(onRegister).toHaveBeenCalledExactlyOnceWith(['note', 'mug']);
  });

  it('고른 것은 줄의 [빼기]로도, 아래 목록의 [빼기]로도 뺀다', () => {
    pick('note', '문구 > 노트'); pick('mug', '리빙 > 머그');
    dialog().props.onDeselect!({ id: 'note', path: '', code: '', text: '' });
    expect(dialog().props.selectedKeys).toEqual(['mug']);
    const chip = footer().find(item => item.type === Button && item.props['aria-label'] === '리빙 > 머그 빼기')!;
    expect(chip).toBeDefined();
    chip.props.onClick?.();
    expect(dialog().props.selectedKeys).toEqual([]);
  });

  it('한 번에 100개까지만 고르고, 넘는 줄에는 이유를 적는다', () => {
    withPicks(Array.from({ length: 100 }, (_, index) => `c${index}`));
    pick('over');
    expect(dialog().props.selectedKeys).toHaveLength(100);
    const view = dialog();
    expect(view.props.rowBlocked!({ id: 'over', path: '', code: '', text: '' })).toBe('최대 100개까지');
    expect(view.props.rowBlocked!({ id: 'c3', path: '', code: '', text: '' })).toBeNull();
  });

  it('저장하는 동안은 고른 것을 바꾸지 못하고, 버튼은 등록하는 중이다', () => {
    pick('note', '문구 > 노트');
    props = { busy: true };
    const element = dialog();
    expect(element.props.onDeselect).toBeUndefined();
    expect(element.props.rowBlocked!({ id: 'mug', path: '', code: '', text: '' })).toBe('등록하는 중');
    expect(element.props.rowBlocked!({ id: 'note', path: '', code: '', text: '' })).toBeNull();
    pick('mug');
    expect(dialog().props.selectedKeys).toEqual(['note']);
    expect(registerButton().props.disabled).toBe(true);
    expect(text(registerButton())).toBe('등록하는 중…');
    const chips = footer().filter(item => item.type === Button && item.props['aria-label'] === '문구 > 노트 빼기');
    expect(chips).toHaveLength(1);
    expect(chips[0].props.disabled).toBe(true);
  });

  it('저장됐는지 모르는 동안도 고른 것을 바꾸지 못하고, 이유를 줄에 적는다', () => {
    withPicks(['note']);
    props = { uncertain: true };
    const element = dialog();
    expect(element.props.onDeselect).toBeUndefined();
    expect(element.props.rowBlocked!({ id: 'mug', path: '', code: '', text: '' })).toBe('저장됐는지 확인한 뒤 고를 수 있습니다');
    expect(registerButton().props.disabled).toBe(true);
  });

  it('저장 결과와 [저장됐는지 확인]은 받은 그대로 창 안 아래쪽에 둔다', () => {
    const status = <p role="alert">저장하지 못했습니다.</p>;
    props = { status };
    expect(footer().some(item => item.props.role === 'alert' && text(item) === '저장하지 못했습니다.')).toBe(true);
  });

  describe('닫을 때', () => {
    it('고른 것이 없으면 묻지 않고 닫는다', async () => {
      dialog().props.onClose();
      await Promise.resolve();
      expect(confirm).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('고른 것이 있으면 몇 개가 아직 등록되지 않았는지와 [N개 등록]을 눌러야 한다는 것을 말하고 묻는다 — 아니오면 창을 그대로 둔다', async () => {
      confirm.restore(); confirm = stubAdminConfirm(false);
      withPicks(['note', 'mug']);
      dialog().props.onClose();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      expect(confirm).toHaveBeenCalledWith('고른 2개는 아직 등록되지 않았습니다. [2개 등록]을 눌러야 등록됩니다.');
      await new Promise(resolve => setTimeout(resolve));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('확인하면 닫는다', async () => {
      withPicks(['note']);
      dialog().props.onClose();
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });

    it('브라우저가 창을 먼저 닫았으면 고른 것을 보면서 답하도록 다시 띄운 뒤 묻는다', async () => {
      withPicks(['note']);
      const showModal = vi.fn();
      footer()[0].props.ref!.current = { closest: () => ({ isConnected: true, open: false, showModal }) };
      dialog().props.onClose();
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(showModal).toHaveBeenCalledOnce();
    });

    it('저장하는 중이거나 결과를 모르는 중에는 묻지 않고 닫는다 — 결과는 화면에 남는다', async () => {
      withPicks(['note']);
      for (const frozen of [{ busy: true }, { uncertain: true }]) {
        onClose.mockClear(); props = frozen;
        dialog().props.onClose();
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      }
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
