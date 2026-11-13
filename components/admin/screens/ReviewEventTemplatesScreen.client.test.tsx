import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }];
  },
}));
vi.mock('@/app/admin/review-event-actions', () => ({ listReviewEventTemplatesAction: mocks.list, saveReviewEventTemplateAction: mocks.save, deleteReviewEventTemplateAction: mocks.remove }));
import { ReviewEventTemplateEditor, ReviewEventTemplatesScreen } from './ReviewEventTemplatesScreen';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { AdminPageHeader } from '../console/AdminKit';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void; value?: string; type?: string; disabled?: boolean; actions?: ReactNode }>;
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; actions?: ReactNode };
  return [node as Element, ...all(props.children), ...all(props.actions)];
}
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function reset() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
const template = { id: '93100000-0000-4000-8000-000000000101', title: '포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요', revision: 2, createdAt: '2026-11-11T01:00:00Z', updatedAt: '2026-11-11T02:00:00Z' };
const page = (rows = [template]) => ({ ok: true, value: { rows, total: rows.length, page: 1, pageSize: 20 } });
const button = (node: ReactNode, label: string) => all(node).find(item => item.type === Button && text(item.props.children) === label);
const inputs = (node: ReactNode) => all(node).filter(item => item.type === Input);

beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; hooks.effects = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('ReviewEventTemplatesScreen (SHEET-017)', () => {
  function render(props: Parameters<typeof ReviewEventTemplatesScreen>[0] = {}) { reset(); return ReviewEventTemplatesScreen(props); }

  it('loads the first page, shows title and description, and says templates save even with the credit policy off', async () => {
    mocks.list.mockResolvedValue(page());
    render(); hooks.effects[0](); await settle();
    const screen = render();
    expect(mocks.list).toHaveBeenCalledWith('', 1);
    expect(text(screen)).toContain(template.title);
    expect(text(screen)).toContain(template.description);
    expect(text(screen)).toContain('적립금 정책이 꺼져 있어도 템플릿은 저장할 수 있습니다');
    const header = all(screen).find(item => item.type === AdminPageHeader)!;
    expect(text(all(header.props.actions).find(item => item.type === Button)?.props.children)).toContain('템플릿 등록');
  });

  it('searches title and description from the form submit (kit buttons default to type=button)', async () => {
    mocks.list.mockResolvedValue(page());
    render(); hooks.effects[0](); await settle();
    inputs(render())[0].props.onChange?.({ target: { value: '포토' } });
    const form = all(render()).find(item => item.type === 'form')!;
    expect(button(form.props.children, '검색')?.props).toMatchObject({ type: 'submit' });
    form.props.onSubmit?.({ preventDefault: () => {} }); await settle();
    expect(mocks.list.mock.calls).toEqual([['', 1], ['포토', 1]]);
  });

  /* 리뷰 지적: 앞뒤 NBSP 같은 행이 있어도 목록은 열리고, 그 행만 불러오기를 막는다. 형식이 깨져 뺀 행은 건수로 알린다. */
  it('keeps the list open around a row that breaks the wording rules and blocks only loading it', async () => {
    const spaced = { ...template, id: '93100000-0000-4000-8000-000000000102', title: `${template.title} ` };
    mocks.list.mockResolvedValue({ ok: true, value: { rows: [spaced, template], total: 3, page: 1, pageSize: 20, skipped: 1 } });
    const onSelect = vi.fn();
    render({ onSelect }); hooks.effects[0](); await settle();
    const picker = render({ onSelect });
    expect(all(picker).filter(item => item.type === Button && text(item.props.children) === '선택').map(item => item.props.disabled)).toEqual([true, false]);
    expect(text(picker)).toContain('불러올 수 없음');
    expect(text(picker)).toContain('형식을 읽지 못한 템플릿 1개는 목록에서 뺐습니다');
    expect(text(picker)).toContain('문구 템플릿 관리에서 고친 뒤 불러오세요');
    const manage = render();
    expect(all(manage).filter(item => item.type === Button && text(item.props.children) === '수정·삭제').map(item => item.props.disabled)).toEqual([undefined, undefined]);
    expect(text(manage)).toContain('수정해 저장하면 앞뒤 공백을 잘라 다시 쓸 수 있습니다');
  });

  it('in the picker, hands the chosen template back without management actions', async () => {
    mocks.list.mockResolvedValue(page());
    const onSelect = vi.fn();
    render({ onSelect }); hooks.effects[0](); await settle();
    const screen = render({ onSelect });
    expect(all(screen).some(item => item.type === AdminPageHeader)).toBe(false);
    expect(button(screen, '수정·삭제')).toBeUndefined();
    expect(text(screen)).toContain('대상·기간·선정 혜택은 그대로');
    button(screen, '선택')!.props.onClick?.();
    expect(onSelect).toHaveBeenCalledWith(template);
  });
});

describe('ReviewEventTemplateEditor (SHEET-017)', () => {
  function render(props: Partial<Parameters<typeof ReviewEventTemplateEditor>[0]> = {}) {
    reset();
    return ReviewEventTemplateEditor({ template: null, onClose: vi.fn(), onSaved: vi.fn(), ...props });
  }
  function submit(node: ReactNode) { all(node).find(item => item.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); }

  it('starts from the editor wording, trims it, and creates the template with revision 0', async () => {
    const onSaved = vi.fn();
    mocks.save.mockResolvedValue({ ok: true, value: { ...template, revision: 1 } });
    const props = { initial: { title: ' 포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요 ' }, onSaved };
    expect(inputs(render(props)).map(item => item.props.value)).toEqual([' 포토리뷰 이벤트', '사진과 함께 후기를 남겨주세요 ']);
    submit(render(props)); await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.any(String), 0, expect.any(String), { title: '포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요' });
    expect(onSaved).toHaveBeenCalledWith({ ...template, revision: 1 });
  });

  it('shows field reasons and does not call the server for wording the event fields would reject', () => {
    submit(render({ initial: { title: '1'.repeat(16), description: '' } }));
    const markup = text(render());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(markup).toContain('이벤트명은 1~15자로 입력하세요.');
    expect(markup).toContain('내용은 1~30자로 입력하세요.');
  });

  it('re-sends the same request when the save result is uncertain', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다.' }).mockResolvedValueOnce({ ok: true, value: template });
    const props = { template };
    submit(render(props)); await settle();
    const first = mocks.save.mock.calls[0];
    expect(first.slice(0, 2)).toEqual([template.id, template.revision]);
    const screen = render(props);
    expect(button(screen, '저장')).toBeUndefined();
    button(screen, '같은 요청 결과 확인')!.props.onClick?.(); await settle();
    expect(mocks.save.mock.calls[1]).toEqual(first);
  });

  it('deletes only after confirmation, with the revision it read', async () => {
    const onDeleted = vi.fn();
    const confirm = vi.fn(() => false);
    setAdminConfirmHandler(async (request) => (confirm as unknown as (message: string) => boolean)(request.message));
    mocks.remove.mockResolvedValue({ ok: true, value: { id: template.id } });
    await button(render({ template, onDeleted }), '삭제')!.props.onClick?.();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('이미 불러와 저장한 이벤트 문구는 바뀌지 않습니다'));
    expect(mocks.remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await button(render({ template, onDeleted }), '삭제')!.props.onClick?.(); await settle();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(template.id, template.revision, expect.any(String));
    expect(onDeleted).toHaveBeenCalledWith(template.id);
  });

  it('offers reloading the latest list after another operator changed the template', async () => {
    const onReload = vi.fn();
    mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 운영자가 이 템플릿을 먼저 고치거나 지웠습니다.' });
    submit(render({ template, onReload })); await settle();
    const screen = render({ template, onReload });
    expect(text(screen)).toContain('다른 운영자가');
    expect(button(screen, '저장')?.props.disabled).toBe(true);
    button(screen, '입력 닫고 최신 목록 조회')!.props.onClick?.();
    expect(onReload).toHaveBeenCalled();
  });
});

afterEach(() => { setAdminConfirmHandler(null); });
