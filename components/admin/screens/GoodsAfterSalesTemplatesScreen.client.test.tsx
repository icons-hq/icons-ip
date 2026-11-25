import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
/* 화면과 편집 창의 상태·ref 칸을 따로 둔다. 편집 창은 화면이 그린 요소를 함수로 다시 불러 그린다. */
const hooks = vi.hoisted(() => ({ scopes: {} as Record<string, unknown[]>, refs: {} as Record<string, { current: unknown }[]>, scope: 'screen', index: 0, refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const refs = hooks.refs[hooks.scope] ??= []; const index = hooks.refIndex++; return refs[index] ??= { current: initial }; },
  useState: (initial: unknown) => {
    const state = hooks.scopes[hooks.scope] ??= []; const index = hooks.index++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-after-sales-actions', () => ({ listGoodsAfterSalesTemplatesAction: mocks.list, saveGoodsAfterSalesTemplateAction: mocks.save }));
import { GoodsAfterSalesTemplatesScreen } from './GoodsAfterSalesTemplatesScreen';
import { GoodsAfterSalesFields } from '../GoodsAfterSalesFields';
import { AdminPageHeader } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import type { GoodsAfterSalesTemplate, GoodsAfterSalesValues } from '@/lib/goods-after-sales';
type Element = ReactElement<{ children?: ReactNode; description?: string; type?: string; busy?: boolean; disabled?: boolean; forTemplate?: boolean; values?: GoodsAfterSalesValues; onClick?: () => void; onClose?: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void; value?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
/** 보관 상태 선택은 kit NativeSelect(네이티브 select를 감싼다)다. */
const isSelect = (item: Element) => item.type === 'select' || item.type === NativeSelect;
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.scope = 'screen'; hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsAfterSalesTemplatesScreen(); }
function pagination(node: ReactNode) { return all(node).find(item => item.type === ConsolePagination) as unknown as ReactElement<{ page: number; total: number; pageSize: number; onPageChange: (page: number) => void }>; }
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
const active: GoodsAfterSalesTemplate = { id: '93800000-0000-4000-8000-000000000501', phone: '02-123', guide: '사용 중 첫 목록', sellerSpecialNotes: '', archived: false, revision: 1, createdAt: '2026-10-13T14:00:00Z' };
const archived = { ...active, id: '93800000-0000-4000-8000-000000000502', guide: '보관된 최신 목록', archived: true };
const page = (row: typeof active) => ({ rows: [row], total: 1, page: 1, pageSize: 20 });
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { vi.clearAllMocks(); hooks.scopes = {}; hooks.refs = {}; hooks.effects = []; confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

it('keeps archive filter and matching rows together when the initial active query finishes last', async () => {
  let initial!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: page(archived) });
  render(); hooks.effects[0]();
  all(render()).find(isSelect)?.props.onChange?.({ target: { value: 'archived' } }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', true, 1]]);
  initial({ ok: true, value: page(active) }); await settle();
  const screen = render();
  expect(all(screen).find(isSelect)?.props.value).toBe('archived');
  expect(text(screen)).toContain(archived.guide);
  expect(text(screen)).not.toContain(active.guide);
});
it.each(['response', 'exception'])('keeps a completed search after a late initial %s error', async kind => {
  let resolveInitial!: (value: unknown) => void, rejectInitial!: (reason: Error) => void;
  const selected = { ...active, guide: '검색된 안내' };
  mocks.list.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; }))
    .mockResolvedValueOnce({ ok: true, value: page(selected) });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'input')?.props.onChange?.({ target: { value: '검색된' } });
  all(render()).find(item => item.type === 'form')?.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['검색된', false, 1]]);
  if (kind === 'exception') rejectInitial(new Error('late network error'));
  else resolveInitial({ ok: false, error: '늦은 조회 오류' });
  await settle();
  expect(text(render())).toContain(selected.guide);
  expect(hooks.scopes.screen[5]).toBe('');
});

it('returns to page one when another operator has removed every remaining row before the next-page read', async () => {
  mocks.list.mockResolvedValueOnce({ ok: true, value: { ...page(active), total: 21 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 2, pageSize: 20 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 1, pageSize: 20 } });
  render(); hooks.effects[0](); await settle();
  /* 페이지 이동은 공용 ConsolePagination(버튼 모드)이다 — 다음 페이지 요청을 그 부품의 onPageChange로 보낸다. */
  pagination(render()).props.onPageChange(2); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', false, 2], ['', false, 1]]);
  expect(pagination(render()).props).toMatchObject({ page: 1, total: 0, pageSize: 20 });
  expect(text(render())).toContain('등록된 A/S 템플릿이 없습니다.');
});

describe('목록', () => {
  it('고르는 창을 겸하지 않는다 — 줄 버튼은 [수정]뿐이고, 설명은 한 문장, 검색 칸은 찾는 범위를 말한다', () => {
    hooks.scopes = { screen: [page(active)] };
    const tree = all(render());
    expect(tree.filter(item => item.type === 'button').map(item => text(item))).toEqual(['초기화', '검색', '수정']);
    expect(tree.find(item => item.type === AdminPageHeader)?.props.description).toBe('템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다.');
    expect(tree.filter(item => item.type === 'label').map(item => text(item))).toEqual(['전화번호·안내·특이사항 검색']);
  });
  it('빈 목록은 검색했는지·보관함인지에 맞춰 말한다', () => {
    const empty = { rows: [], total: 0, page: 1, pageSize: 20 };
    hooks.scopes = { screen: [empty, '', '수리'] }; expect(text(render())).toContain('조건에 맞는 템플릿이 없습니다.');
    hooks.scopes = { screen: [empty, '', '', true] }; expect(text(render())).toContain('보관한 템플릿이 없습니다.');
  });
});

describe('편집 창', () => {
  /** 화면의 편집 상태(`{ template }`)는 일곱 번째 상태 칸이다. */
  const open = (template: GoodsAfterSalesTemplate | null) => { hooks.scopes = { screen: Object.assign([], { 6: { template } }) }; hooks.refs = {}; };
  function editor() {
    const host = all(render()).find(item => typeof item.type === 'function' && item.type.name === 'AfterSalesTemplateEditor');
    if (!host) throw new Error('AfterSalesTemplateEditor');
    hooks.scope = 'editor'; hooks.index = 0; hooks.refIndex = 0;
    return all((host.type as (props: Element['props']) => ReactNode)(host.props));
  }
  const button = (label: string) => { const item = editor().find(node => node.type === 'button' && text(node) === label); if (!item) throw new Error(label); return item; };
  const hasButton = (label: string) => editor().some(node => node.type === 'button' && text(node) === label);
  const fields = () => editor().find(node => node.type === GoodsAfterSalesFields) as unknown as ReactElement<{ values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void; forTemplate?: boolean }>;
  const write = (guide: string) => fields().props.onChange({ ...fields().props.values, guide });
  const submit = () => editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} });
  const dialog = () => editor().find(node => node.type === CustomerServiceDialog)!;
  const stillOpen = () => hooks.scopes.screen[6] !== null;
  beforeEach(() => { open(active); mocks.list.mockResolvedValue({ ok: true, value: page(active) }); });

  it('템플릿 편집 창에는 상품정보제공고시 연락처 한 줄과 되풀이 설명을 두지 않는다', () => {
    expect(fields().props.forTemplate).toBe(true);
    expect(text(editor())).not.toMatch(/템플릿 수정·보관으로|상품에 복사됩니다/);
  });

  it('[저장]은 적은 내용을 보관 상태 그대로 저장한다', async () => {
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, guide: '고친 안내', revision: 2 } });
    write('고친 안내'); submit(); await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(active.id, { phone: '02-123', guide: '고친 안내', sellerSpecialNotes: '' }, false, 1, expect.any(String));
    expect(stillOpen()).toBe(false);
  });


  /* G5(2026-11-25 리뷰): 저장·보관·복원 뒤 창이 닫히고 줄이 말없이 사라지면 지워진 줄 안다. 목록 위에 결과 한 줄을 보인다(사진 보관함과 같은 말). */
  const notice = () => all(render()).filter(item => (item.props as Record<string, unknown>)['data-goods-template-notice'] !== undefined).map(item => text(item));
  it('저장·보관·복원에 성공하면 목록 위에 무엇을 했는지와 어디서 다시 보는지를 한 줄로 알린다', async () => {
    expect(notice()).toEqual([]);
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, guide: '고친 안내', revision: 2 } });
    write('고친 안내'); submit(); await settle();
    expect(stillOpen()).toBe(false); expect(notice()).toEqual(['템플릿을 저장했습니다.']);
    open(active); mocks.save.mockResolvedValue({ ok: true, value: { ...active, archived: true, revision: 2 } });
    button('보관').props.onClick?.(); await settle();
    expect(notice()).toEqual(["보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있습니다."]);
    open(archived); mocks.save.mockResolvedValue({ ok: true, value: { ...archived, archived: false, revision: 2 } });
    button('복원').props.onClick?.(); await settle();
    expect(notice()).toEqual(["복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다."]);
  });

  it('비어 있는 칸은 저장하기 전에 어느 칸인지 말한다', () => {
    write('   '); submit();
    expect(mocks.save).not.toHaveBeenCalled(); expect(text(editor())).toContain('A/S 안내를 적어 주세요.');
  });

  it('[보관]은 보관 상태만 바꾼다 — 고친 안내는 보내지 않고, 고친 내용이 있으면 사라진다고 먼저 묻는다', async () => {
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, archived: true, revision: 2 } });
    write('고치던 안내'); button('보관').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('[보관]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.');
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(active.id, { phone: '02-123', guide: '사용 중 첫 목록', sellerSpecialNotes: '' }, true, 1, expect.any(String));
  });

  it('고친 내용이 없으면 묻지 않고, 보관된 템플릿은 [복원]으로 되돌린다', async () => {
    open(archived); mocks.save.mockResolvedValue({ ok: true, value: { ...archived, archived: false, revision: 2 } });
    expect(hasButton('보관')).toBe(false); expect(hasButton('복구')).toBe(false);
    button('복원').props.onClick?.(); await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(archived.id, { phone: '02-123', guide: '보관된 최신 목록', sellerSpecialNotes: '' }, false, 1, expect.any(String));
  });

  it('다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다 — 최신 내용 위에 저장하면 최신 것을 기준으로 내 입력을 보낸다', async () => {
    const theirs = { ...active, guide: '다른 담당자 안내', archived: true, revision: 4 };
    mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 적은 내용은 그대로 있습니다.' }).mockResolvedValueOnce({ ok: true, value: { ...theirs, guide: '내가 고친 안내', revision: 5 } });
    /* 사용 중 목록에 없으면 보관됨 목록까지 찾아본다. */
    mocks.list.mockImplementation(async (_query: string, archivedOnly: boolean) => ({ ok: true, value: { rows: archivedOnly ? [theirs] : [], total: archivedOnly ? 1 : 0, page: 1, pageSize: 20 } }));
    write('내가 고친 안내'); submit(); await settle();
    expect(fields().props.values.guide).toBe('내가 고친 안내');
    expect(editor().find(node => node.type === 'fieldset')?.props.disabled).toBe(false);
    const shown = text(editor());
    expect(shown).toContain('다른 사람이 먼저 바꿨습니다.'); expect(shown).toContain('지금 저장된 내용 · 보관됨'); expect(shown).toContain('다른 담당자 안내');
    expect(hasButton('저장')).toBe(false); expect(hasButton('입력 닫고 최신 목록 조회')).toBe(false);
    button('내 입력으로 덮어쓰기').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual([active.id, { phone: '02-123', guide: '내가 고친 안내', sellerSpecialNotes: '' }, true, 4, expect.any(String)]);
    expect(stillOpen()).toBe(false);
  });

  it('[내 입력 버리기]는 확인한 뒤에만 닫고 목록을 다시 불러온다', async () => {
    mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 적은 내용은 그대로 있습니다.' });
    write('내가 고친 안내'); submit(); await settle();
    confirm.restore(); confirm = stubAdminConfirm(false);
    button('내 입력 버리기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.'); expect(stillOpen()).toBe(true);
    confirm.restore(); confirm = stubAdminConfirm(true); mocks.list.mockClear();
    button('내 입력 버리기').props.onClick?.(); await settle();
    expect(stillOpen()).toBe(false); expect(mocks.list).toHaveBeenCalledWith('', false, 1);
  });

  it('고치다가 닫으면 적은 내용이 사라진다고 묻고, 고친 것이 없으면 그냥 닫는다', async () => {
    button('닫기').props.onClick?.(); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(stillOpen()).toBe(false);
    open(active); confirm.restore(); confirm = stubAdminConfirm(false);
    write('고치던 안내'); dialog().props.onClose?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.'); expect(stillOpen()).toBe(true);
  });

  it('저장됐는지 모를 때는 같은 내용으로 다시 확인하고, 창은 확인을 거쳐 닫을 수 있다', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: '옛 문구' }).mockResolvedValueOnce({ ok: false, uncertain: true, error: '옛 문구' });
    write('고친 안내'); submit(); await settle();
    expect(text(editor())).toContain(SAVE_UNKNOWN_MESSAGE); expect(text(editor())).not.toContain('옛 문구');
    expect(dialog().props.busy).toBe(false); expect(button('닫기').props.disabled).toBe(false); expect(hasButton('보관')).toBe(true); expect(button('보관').props.disabled).toBe(true);
    button('저장됐는지 확인').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
    button('닫기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 다시 적어야 합니다.'); expect(stillOpen()).toBe(false);
  });
});
