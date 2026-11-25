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
vi.mock('@/app/admin/goods-benefit-actions', () => ({ listGoodsEventTemplatesAction: mocks.list, saveGoodsEventTemplateAction: mocks.save }));
import { GoodsEventTemplatesScreen } from './GoodsEventTemplatesScreen';
import { AdminPageHeader } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
import { AdminSelect } from '../console/AdminSelect';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import type { GoodsEventTemplate } from '@/lib/goods-benefits';
type Element = ReactElement<{ children?: ReactNode; description?: string; type?: string; busy?: boolean; disabled?: boolean; onClick?: () => void; onClose?: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void; value?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.scope = 'screen'; hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsEventTemplatesScreen(); }
function pagination(node: ReactNode) { return all(node).find(item => item.type === ConsolePagination) as unknown as ReactElement<{ page: number; total: number; pageSize: number; onPageChange: (page: number) => void }>; }
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
const active: GoodsEventTemplate = { id: '93800000-0000-4000-8000-000000000501', eventText: '사용 중 첫 목록', archived: false, revision: 1, createdAt: '2026-10-13T14:00:00Z' };
const archived = { ...active, id: '93800000-0000-4000-8000-000000000502', eventText: '보관된 최신 목록', archived: true };
const page = (row: typeof active) => ({ rows: [row], total: 1, page: 1, pageSize: 20 });
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { vi.clearAllMocks(); hooks.scopes = {}; hooks.refs = {}; hooks.effects = []; confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

it('keeps archive filter and matching rows together when the initial active query finishes last', async () => {
  let initial!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: page(archived) });
  render(); hooks.effects[0]();
  all(render()).find(item => (item.type === 'select' || item.type === AdminSelect))?.props.onChange?.({ target: { value: 'archived' } }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', true, 1]]);
  initial({ ok: true, value: page(active) }); await settle();
  const screen = render();
  expect(all(screen).find(item => (item.type === 'select' || item.type === AdminSelect))?.props.value).toBe('archived');
  expect(text(screen)).toContain(archived.eventText);
  expect(text(screen)).not.toContain(active.eventText);
});
it.each(['response', 'exception'])('keeps a completed search after a late initial %s error', async kind => {
  let resolveInitial!: (value: unknown) => void, rejectInitial!: (reason: Error) => void;
  const selected = { ...active, eventText: '검색된 안내' };
  mocks.list.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; }))
    .mockResolvedValueOnce({ ok: true, value: page(selected) });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'input' || item.type === Input)?.props.onChange?.({ target: { value: '검색된' } });
  all(render()).find(item => item.type === 'form')?.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['검색된', false, 1]]);
  if (kind === 'exception') rejectInitial(new Error('late network error'));
  else resolveInitial({ ok: false, error: '늦은 조회 오류' });
  await settle();
  expect(text(render())).toContain(selected.eventText);
  expect(hooks.scopes.screen[5]).toBe('');
});

it('returns to page one when another operator has archived every remaining row', async () => {
  mocks.list.mockResolvedValueOnce({ ok: true, value: { ...page(active), total: 21 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 2, pageSize: 20 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 1, pageSize: 20 } });
  render(); hooks.effects[0](); await settle();
  /* 페이지 이동은 공용 ConsolePagination(버튼 모드)이다 — 다음 페이지 요청을 그 부품의 onPageChange로 보낸다. */
  pagination(render()).props.onPageChange(2); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', false, 2], ['', false, 1]]);
  expect(pagination(render()).props).toMatchObject({ page: 1, total: 0, pageSize: 20 });
  expect(text(render())).toContain('등록된 이벤트 템플릿이 없습니다.');
});

it('검색은 폼 제출이다(kit 버튼의 기본 type은 button)', () => {
  mocks.list.mockResolvedValue({ ok: true, value: page(active) });
  const form = all(render()).find(item => item.type === 'form')!;
  expect(all(form.props.children).find(item => item.type === Button && text(item) === '검색')?.props).toMatchObject({ type: 'submit' });
});

describe('목록', () => {
  it('고르는 창을 겸하지 않는다 — 줄 버튼은 [수정]뿐이고, 설명은 한 문장이다', () => {
    hooks.scopes = { screen: [page(active)] };
    const tree = all(render());
    expect(tree.filter(item => item.type === Button).map(item => text(item))).toEqual(['초기화', '검색', '수정']);
    expect(tree.find(item => item.type === AdminPageHeader)?.props.description).toBe('템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다.');
  });
  it('빈 목록은 검색했는지·보관함인지에 맞춰 말한다', () => {
    const empty = { rows: [], total: 0, page: 1, pageSize: 20 };
    hooks.scopes = { screen: [empty, '', '증정'] }; expect(text(render())).toContain('조건에 맞는 템플릿이 없습니다.');
    hooks.scopes = { screen: [empty, '', '', true] }; expect(text(render())).toContain('보관한 템플릿이 없습니다.');
  });
});

describe('편집 창', () => {
  /** 화면의 편집 상태(`{ template }`)는 일곱 번째 상태 칸이다. */
  const open = (template: GoodsEventTemplate | null) => { hooks.scopes = { screen: Object.assign([], { 6: { template } }) }; hooks.refs = {}; };
  function editor() {
    const host = all(render()).find(item => typeof item.type === 'function' && item.type.name === 'EventTemplateEditor');
    if (!host) throw new Error('EventTemplateEditor');
    hooks.scope = 'editor'; hooks.index = 0; hooks.refIndex = 0;
    return all((host.type as (props: Element['props']) => ReactNode)(host.props));
  }
  const button = (label: string) => { const item = editor().find(node => node.type === Button && text(node) === label); if (!item) throw new Error(label); return item; };
  const hasButton = (label: string) => editor().some(node => node.type === Button && text(node) === label);
  const input = () => editor().find(node => node.type === Input)!;
  const write = (value: string) => input().props.onChange?.({ target: { value } });
  const submit = () => editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} });
  const dialog = () => editor().find(node => node.type === CustomerServiceDialog)!;
  const stillOpen = () => hooks.scopes.screen[6] !== null;
  beforeEach(() => { open(active); mocks.list.mockResolvedValue({ ok: true, value: page(active) }); });

  it('[저장]은 적은 문구를 보관 상태 그대로 저장하고, 편집 창에는 되풀이 설명을 두지 않는다', async () => {
    expect(text(editor())).not.toMatch(/템플릿 수정·보관으로|상품에 복사됩니다/);
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, eventText: '고친 문구', revision: 2 } });
    write('고친 문구'); submit(); await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(active.id, '고친 문구', false, 1, expect.any(String)); expect(stillOpen()).toBe(false);
  });


  /* G5(2026-11-25 리뷰): 저장·보관·복원 뒤 창이 닫히고 줄이 말없이 사라지면 지워진 줄 안다. 목록 위에 결과 한 줄을 보인다(사진 보관함과 같은 말). */
  const notice = () => all(render()).filter(item => (item.props as Record<string, unknown>)['data-goods-template-notice'] !== undefined).map(item => text(item));
  it('저장·보관·복원에 성공하면 목록 위에 무엇을 했는지와 어디서 다시 보는지를 한 줄로 알린다', async () => {
    expect(notice()).toEqual([]);
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, eventText: '고친 문구', revision: 2 } });
    write('고친 문구'); submit(); await settle();
    expect(stillOpen()).toBe(false); expect(notice()).toEqual(['템플릿을 저장했습니다.']);
    open(active); mocks.save.mockResolvedValue({ ok: true, value: { ...active, archived: true, revision: 2 } });
    button('보관').props.onClick?.(); await settle();
    expect(notice()).toEqual(["보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있습니다."]);
    open(archived); mocks.save.mockResolvedValue({ ok: true, value: { ...archived, archived: false, revision: 2 } });
    button('복원').props.onClick?.(); await settle();
    expect(notice()).toEqual(["복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다."]);
    /* 다음 조회에서는 지운다. */
    all(render()).find(item => item.type === 'form')?.props.onSubmit?.({ preventDefault: () => {} }); await settle();
    expect(notice()).toEqual([]);
  });

  it('그냥 닫거나 입력을 버리면 결과 한 줄을 보이지 않는다', async () => {
    button('닫기').props.onClick?.(); await settle();
    expect(stillOpen()).toBe(false); expect(notice()).toEqual([]);
  });

  it('빈 문구는 저장하기 전에 알린다', () => {
    write('  '); submit();
    expect(mocks.save).not.toHaveBeenCalled(); expect(text(editor())).toContain('이벤트 문구를 적어 주세요.');
  });

  it('[보관]은 보관 상태만 바꾼다 — 고친 문구는 보내지 않고, 고친 내용이 있으면 사라진다고 먼저 묻는다', async () => {
    mocks.save.mockResolvedValue({ ok: true, value: { ...active, archived: true, revision: 2 } });
    write('고치던 문구'); button('보관').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('[보관]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.');
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(active.id, '사용 중 첫 목록', true, 1, expect.any(String));
  });

  it('고친 내용이 없으면 묻지 않고, 보관된 템플릿은 [복원]으로 되돌린다', async () => {
    open(archived); mocks.save.mockResolvedValue({ ok: true, value: { ...archived, archived: false, revision: 2 } });
    expect(hasButton('보관')).toBe(false); expect(hasButton('복구')).toBe(false);
    button('복원').props.onClick?.(); await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(archived.id, '보관된 최신 목록', false, 1, expect.any(String));
  });

  it('다른 사람이 먼저 바꿨으면 입력 칸을 열어 둔 채 두 길을 고른다(A/S 템플릿과 같다)', async () => {
    const theirs = { ...active, eventText: '다른 담당자 문구', revision: 4 };
    mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 적은 문구는 그대로 있습니다.' }).mockResolvedValueOnce({ ok: true, value: { ...theirs, eventText: '내가 고친 문구', revision: 5 } });
    mocks.list.mockResolvedValue({ ok: true, value: page(theirs) });
    write('내가 고친 문구'); submit(); await settle();
    expect(input().props.value).toBe('내가 고친 문구'); expect(editor().find(node => node.type === 'fieldset')?.props.disabled).toBe(false);
    const shown = text(editor());
    expect(shown).toContain('다른 사람이 먼저 바꿨습니다.'); expect(shown).toContain('지금 저장된 문구'); expect(shown).toContain('다른 담당자 문구');
    expect(hasButton('저장')).toBe(false); expect(hasButton('보관')).toBe(false); expect(hasButton('입력 닫고 최신 목록 조회')).toBe(false);
    button('내 입력으로 덮어쓰기').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual([active.id, '내가 고친 문구', false, 4, expect.any(String)]); expect(stillOpen()).toBe(false);
  });

  it('지금 저장된 문구를 찾지 못했으면 누를 때 다시 찾고, 그래도 못 찾으면 입력을 둔 채 알린다', async () => {
    mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 적은 문구는 그대로 있습니다.' });
    mocks.list.mockResolvedValue({ ok: false, error: '조회 실패' });
    write('내가 고친 문구'); submit(); await settle();
    expect(text(editor())).not.toContain('지금 저장된 문구');
    button('내 입력으로 덮어쓰기').props.onClick?.(); await settle();
    expect(mocks.save).toHaveBeenCalledOnce(); expect(text(editor())).toContain('지금 저장된 내용을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    expect(input().props.value).toBe('내가 고친 문구'); expect(hasButton('내 입력 버리기')).toBe(true);
  });

  it('[내 입력 버리기]와 고치다가 닫기는 확인한 뒤에만 닫는다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    write('고치던 문구'); dialog().props.onClose?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.'); expect(stillOpen()).toBe(true);
    mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 사람이 먼저 바꿨습니다. 적은 문구는 그대로 있습니다.' });
    submit(); await settle(); confirm.mockClear();
    button('내 입력 버리기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.'); expect(stillOpen()).toBe(true);
    confirm.restore(); confirm = stubAdminConfirm(true);
    button('내 입력 버리기').props.onClick?.(); await settle();
    expect(stillOpen()).toBe(false);
  });

  it('저장됐는지 모를 때는 같은 내용으로 다시 확인하고, 창은 확인을 거쳐 닫을 수 있다', async () => {
    mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '옛 문구' });
    write('고친 문구'); submit(); await settle();
    expect(text(editor())).toContain(SAVE_UNKNOWN_MESSAGE); expect(text(editor())).not.toContain('옛 문구');
    expect(dialog().props.busy).toBe(false); expect(button('닫기').props.disabled).toBe(false); expect(hasButton('같은 요청 결과 확인')).toBe(false);
    button('저장됐는지 확인').props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
    button('닫기').props.onClick?.(); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 다시 적어야 합니다.'); expect(stillOpen()).toBe(false);
  });
});
