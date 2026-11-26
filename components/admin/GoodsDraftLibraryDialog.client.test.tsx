import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => unknown)[] }));
const actions = vi.hoisted(() => ({ find: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-draft-actions', () => ({ findGoodsDraftsAction: actions.find, getGoodsDraftAction: actions.get, setGoodsDraftArchivedAction: actions.set, saveGoodsDraftAction: vi.fn() }));
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { GoodsDraft, GoodsDraftSummary } from '@/lib/admin/goods-drafts';
import type { AdminPickerRequest, AdminPickerResult } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { GoodsDraftLibraryDialog } from './GoodsDraftLibraryDialog';

type El = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string }>;
type Props = AdminPickerPanelProps<GoodsDraftSummary> & { title: string; filterLabel: string; description: string };
const all = (node: ReactNode): El[] => Array.isArray(node) ? node.flatMap(all) : isValidElement<{ children?: ReactNode }>(node) ? [node as El, ...all(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const request = (patch: Partial<AdminPickerRequest> = {}): AdminPickerRequest => ({ query: '', field: '', filter: '', page: 1, ...patch });
const pageOf = (result: AdminPickerResult<unknown>) => { if ('error' in result) throw new Error(result.error); return result; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const A = '94700000-0000-4000-8000-00000000000a', B = '94700000-0000-4000-8000-00000000000b';
const IMAGE = 'public-media/catalog/good/11111111-1111-4111-8111-111111111111.jpg';
const draft = (id: string, patch: Partial<GoodsDraftSummary> = {}): GoodsDraftSummary => ({ id, name: id === A ? '볼펜 세트' : '키링', imagePath: null, revision: 1, updatedAt: '2026-11-25T06:12:00Z', archived: false, completedGoodId: null, ...patch });
const onClose = vi.fn(), onLoad = vi.fn();
let confirm: ReturnType<typeof stubAdminConfirm>;

function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsDraftLibraryDialog({ onClose, onLoad }) as unknown as ReactElement<Props>; }
/** 줄 오른쪽 버튼들(이름은 화면에 보이는 글자만, 읽어 주는 이름은 따로). */
function buttons(row: GoodsDraftSummary) { return all(render().props.rowAction!(row, { busy: false })).filter(item => item.type === 'button'); }
const visible = (row: GoodsDraftSummary) => buttons(row).map(item => text(item).replace(`${row.name} `, ''));
const press = (row: GoodsDraftSummary, label: string) => { const found = buttons(row).find(item => text(item).endsWith(label)); if (!found) throw new Error(label); found.props.onClick?.(); };

beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.effects = []; vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  confirm = stubAdminConfirm(true);
  actions.get.mockResolvedValue({ data: { ...draft(A), values: { name: '볼펜 세트' } } satisfies GoodsDraft });
  onLoad.mockResolvedValue(true);
});
afterEach(() => { confirm.restore(); vi.unstubAllEnvs(); });

describe('공용 선택창으로 그린다', () => {
  it('창 이름·한 줄 안내·빠진 항목 알림·보기 선택이 화면 규칙대로다', () => {
    const element = render();
    expect(element.type).toBe(AdminPickerDialog);
    expect(element.props).toMatchObject({
      title: '임시저장 고르기', filterLabel: '보기', showImages: true, searchPlaceholder: '상품명으로 찾기', emptyText: '임시저장한 상품이 없습니다.',
      description: '내 임시저장을 최근 40건까지 보관하고, 넘으면 가장 오래된 것이 삭제한 항목으로 옮겨집니다.',
      excludedNote: '상품으로 등록을 마친 임시저장은 목록에서 뺐습니다.',
      filterOptions: [{ value: '', label: '저장한 항목' }, { value: 'archived', label: '삭제한 항목' }],
    });
    expect(element.props.onClose).toBe(onClose);
  });

  it('쓰지 않는 말(복구·표시·불러오기 창 이름)과 안내 네 문장이 없다', () => {
    const element = render();
    const shown = [element.props.title, element.props.description, element.props.excludedNote, ...element.props.filterOptions!.map(option => option.label)].join(' ');
    expect(shown).not.toMatch(/복구|저장하기가 완료|다른 기기/);
    expect(element.props.description.length).toBeLessThan(60);
  });

  it('[선택] 대신 줄 버튼을 쓰므로 고르기 동작은 비어 있다', () => {
    expect(render().props.onSelect(draft(A))).toBe(false);
  });
});

describe('목록 조회는 지금 쓰는 액션 그대로다', () => {
  it('검색어·보기·쪽을 그대로 넘기고 받은 쪽을 돌려준다', async () => {
    const data = { rows: [draft(A)], total: 1, page: 1, pageSize: 20 };
    actions.find.mockResolvedValue({ data });
    expect(pageOf(await render().props.load(request({ query: '볼펜' })))).toEqual(data);
    expect(actions.find).toHaveBeenLastCalledWith('볼펜', false, 1);
    await render().props.load(request({ filter: 'archived', page: 1 }));
    expect(actions.find).toHaveBeenLastCalledWith('', true, 1);
  });

  it('읽지 못하면 액션이 준 이유를, 이유가 없으면 다시 검색하라는 말을 돌려준다', async () => {
    actions.find.mockResolvedValueOnce({ error: '관리자 권한이 필요합니다.' }).mockResolvedValueOnce({});
    expect(await render().props.load(request())).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await render().props.load(request())).toEqual({ error: '목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
  });

  it('끝 쪽을 넘어선 쪽을 달라고 하면 마지막 쪽으로 돌린다', async () => {
    actions.find.mockImplementation(async (_query: string, _archived: boolean, page: number) => ({ data: { rows: page === 2 ? [draft(A)] : [], total: 21, page, pageSize: 20 } }));
    const result = pageOf(await render().props.load(request({ page: 5 })));
    expect(result.page).toBe(2);
    expect(actions.find.mock.calls.map(call => call[2])).toEqual([5, 2]);
  });
});

describe('줄', () => {
  it('이름·마지막 저장 시각(KST)·사진을 보인다', () => {
    const row = draft(A, { imagePath: IMAGE });
    const view = render().props.rowView(row);
    expect(view.title).toBe('볼펜 세트');
    expect(view.meta).toMatch(/^마지막 저장 .+ \(KST\)$/);
    expect(view.meta).toContain('오후 3:12');
    expect(view.imageUrl).toBe(`https://example.supabase.co/storage/v1/object/public/public-media/${IMAGE.replace('public-media/', '')}`);
    expect(render().props.rowView(draft(B)).imageUrl).toBeNull();
    expect(render().props.rowKey(row)).toBe(A);
  });

  it('삭제한 항목은 삭제한 시각이라고 적는다', () => {
    expect(render().props.rowView(draft(A, { archived: true })).meta).toMatch(/^삭제 .+ \(KST\)$/);
  });

  it('저장한 항목에는 [불러오기]와 [삭제], 삭제한 항목에는 [복원]만 둔다', () => {
    expect(visible(draft(A))).toEqual(['불러오기', '삭제']);
    expect(visible(draft(A, { archived: true }))).toEqual(['복원']);
  });

  it('줄마다 같은 이름의 버튼이 늘어서므로 읽어 주는 이름에 임시저장 이름을 붙인다', () => {
    expect(buttons(draft(A)).map(item => text(item))).toEqual(['볼펜 세트 불러오기', '볼펜 세트 삭제']);
  });
});

describe('[불러오기]', () => {
  it('내용을 읽어 편집기에 건네고, 적용되면 창을 닫는다', async () => {
    press(draft(A), '불러오기'); await settle();
    expect(actions.get).toHaveBeenCalledExactlyOnceWith(A);
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('편집기가 바꾸지 않기로 하면(입력을 지키려고) 창을 그대로 둔다', async () => {
    onLoad.mockResolvedValue(false);
    press(draft(A), '불러오기'); await settle();
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(render().props.rowAction!(draft(A), { busy: false })).toBeTruthy();
  });

  it('읽지 못하면 이유를 창 아래에 알리고 닫지 않는다', async () => {
    actions.get.mockResolvedValue({ error: '삭제했거나 상품으로 등록한 임시저장입니다. 목록을 다시 조회해주세요.' });
    press(draft(A), '불러오기'); await settle();
    expect(onLoad).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const alert = all(render().props.footer).find(item => item.props.role === 'alert');
    expect(text(alert)).toBe('삭제했거나 상품으로 등록한 임시저장입니다. 목록을 다시 조회해주세요.');
  });

  it('창을 닫은 뒤에 읽기가 끝나면 편집기를 건드리지 않는다', async () => {
    let finish!: (value: unknown) => void;
    actions.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(); const cleanup = hooks.effects[0]();
    press(draft(A), '불러오기');
    (cleanup as () => void)();
    finish({ data: { ...draft(A), values: { name: '볼펜 세트' } } }); await settle();
    expect(onLoad).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('[삭제]와 [복원]', () => {
  it('삭제는 이름을 말하고 먼저 묻는다 — 아니오면 아무것도 바뀌지 않는다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    press(draft(A), '삭제'); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('‘볼펜 세트’ 임시저장을 삭제합니다. 삭제한 항목에서 다시 복원할 수 있습니다.');
    expect(actions.set).not.toHaveBeenCalled();
  });

  it('확인하면 삭제하고, 그 줄은 목록에서 빼지 않고 자리에서 [복원]으로 바꿔 되돌릴 수 있게 한다', async () => {
    const row = draft(A);
    actions.set.mockResolvedValue({ data: { ...row, revision: 2, archived: true } });
    press(row, '삭제'); await settle();
    expect(actions.set).toHaveBeenCalledExactlyOnceWith(row, true);
    expect(visible(row)).toEqual(['복원']);
    expect(render().props.rowView(row).meta).toMatch(/ · 삭제했습니다$/);
    // 되돌릴 때는 바뀐 저장 번호로 보낸다.
    actions.set.mockResolvedValue({ data: { ...row, revision: 3, archived: false } });
    press(row, '복원'); await settle();
    expect(actions.set).toHaveBeenLastCalledWith({ ...row, revision: 2, archived: true }, false);
    expect(visible(row)).toEqual(['불러오기', '삭제']);
    expect(render().props.rowView(row).meta).toMatch(/ · 복원했습니다$/);
  });

  it('삭제한 항목의 [복원]은 묻지 않는다', async () => {
    const row = draft(B, { archived: true });
    actions.set.mockResolvedValue({ data: { ...row, revision: 2, archived: false } });
    press(row, '복원'); await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(actions.set).toHaveBeenCalledExactlyOnceWith(row, false);
    expect(visible(row)).toEqual(['불러오기', '삭제']);
  });

  it('바꾸지 못하면 이유를 알리고 줄은 그대로 둔다', async () => {
    const row = draft(A);
    actions.set.mockResolvedValue({ error: '다른 창에서 임시저장이 변경되었습니다.' });
    press(row, '삭제'); await settle();
    expect(visible(row)).toEqual(['불러오기', '삭제']);
    expect(text(all(render().props.footer).find(item => item.props.role === 'alert'))).toBe('다른 창에서 임시저장이 변경되었습니다.');
  });

  it('결과를 모르면 목록을 다시 검색해 확인하라고 알린다', async () => {
    actions.set.mockRejectedValue(new Error('network'));
    press(draft(A), '삭제'); await settle();
    expect(text(all(render().props.footer).find(item => item.props.role === 'alert'))).toBe('처리 결과를 확인하지 못했습니다. 목록을 다시 검색해 확인해주세요.');
  });
});

describe('한 번에 하나만', () => {
  it('하는 중에는 모든 줄의 버튼을 막고, 끝나면 푼다', async () => {
    let finish!: (value: unknown) => void;
    actions.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    press(draft(A), '불러오기');
    expect(buttons(draft(B)).every(item => item.props.disabled)).toBe(true);
    expect(text(all(render().props.footer))).toContain('처리하는 중입니다.');
    press(draft(B), '불러오기');
    expect(actions.get).toHaveBeenCalledOnce();
    finish({ error: '끝' }); await settle();
    expect(buttons(draft(B)).every(item => !item.props.disabled)).toBe(true);
  });

  it('목록을 읽는 중(창이 막은 동안)에도 줄 버튼을 막는다', () => {
    expect(all(render().props.rowAction!(draft(A), { busy: true })).filter(item => item.type === 'button').every(item => item.props.disabled)).toBe(true);
  });
});

describe('목록을 새로 읽으면', () => {
  it('자리에서 바꿔 둔 표시를 지운다 — 새 목록이 지금의 사실이다', async () => {
    const row = draft(A);
    actions.set.mockResolvedValue({ data: { ...row, revision: 2, archived: true } });
    press(row, '삭제'); await settle();
    expect(visible(row)).toEqual(['복원']);
    actions.find.mockResolvedValue({ data: { rows: [{ ...row, revision: 2, archived: true }], total: 1, page: 1, pageSize: 20 } });
    await render().props.load(request({ filter: 'archived' }));
    expect(render().props.rowView({ ...row, revision: 2, archived: true }).meta).not.toContain('삭제했습니다');
  });

  it('읽지 못했을 때는 표시를 그대로 둔다', async () => {
    const row = draft(A);
    actions.set.mockResolvedValue({ data: { ...row, revision: 2, archived: true } });
    press(row, '삭제'); await settle();
    actions.find.mockResolvedValue({ error: '읽지 못했습니다.' });
    await render().props.load(request());
    expect(visible(row)).toEqual(['복원']);
  });
});
