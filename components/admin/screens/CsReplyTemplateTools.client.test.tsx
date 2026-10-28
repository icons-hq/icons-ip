import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CsTemplateWorkspace } from '@/lib/admin/cs-editor-drafts';
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), archive: vi.fn(), latest: vi.fn(), states: [] as unknown[], index: 0,
  value: null as CsTemplateWorkspace | null, recovery: null as CsTemplateWorkspace | null, persisted: null as CsTemplateWorkspace | null }));
vi.mock('@/app/admin/cs-reply-actions', () => ({ listCsReplyTemplatesAction: mocks.list, saveCsReplyTemplateAction: mocks.save,
  archiveCsReplyTemplateAction: mocks.archive, readCsReplyTemplateAction: mocks.latest }));
vi.mock('@/components/admin/useCsEditorDraft', () => ({ useCsEditorDraft: () => ({ value: mocks.value, recovery: mocks.recovery,
  ready: true, blocked: false, unavailable: false, saved: Boolean(mocks.persisted),
  change: (value: CsTemplateWorkspace | null) => { mocks.value = value; mocks.persisted = value; mocks.recovery = null; return true; },
  restore: () => { mocks.value = mocks.recovery; mocks.recovery = null; return mocks.value; },
  discard: () => { mocks.value = null; mocks.recovery = null; mocks.persisted = null; },
}) }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useTransition: () => [false, (work: () => Promise<void>) => { void work(); }], useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  } };
});
import { CsReplyTemplateTools } from './CsReplyTemplateTools';
type Element = ReactElement<Record<string, unknown>>;
const rows = [{ id: '10000000-0000-4000-8000-000000000001', surface: 'review', category: 'other', title: '기존 A', body: 'A 본문', revision: 1, archivedAt: null, updatedAt: '2026-10-13T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000002', surface: 'review', category: 'shipping', title: '기존 B', body: 'B 본문', revision: 1, archivedAt: null, updatedAt: '2026-10-13T00:00:00Z' }];
function render() { mocks.index = 0; return CsReplyTemplateTools({ accountId: 'staff', surface: 'review', body: '미저장 리뷰 답글', onInsert: vi.fn() }) as Element; }
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function button(root: ReactNode, label: string) { const result = nodes(root).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!result) throw new Error(`Missing button ${label}`); return result; }
function click(node: Element) { (node.props.onClick as () => void)(); }
function input(root: ReactNode, label: string) {
  const wrapper = nodes(root).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label));
  const field = wrapper && nodes(wrapper).find(node => node.type === 'input' || node.type === 'textarea');
  if (!field) throw new Error(`Missing field ${label}`); return field;
}
function change(label: string, value: string) { (input(render(), label).props.onChange as (event: unknown) => void)({ target: { value } }); }
function edit(title: string) { click(button(nodes(render()).find(node => node.type === 'article' && text(node).includes(title))!, '수정')); }
function submit() { (nodes(render()).find(node => node.type === 'form' && node.props.className === 'admin-cs-template__editor')!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); }
async function settle() { for (let i = 0; i < 14; i++) await Promise.resolve(); }
async function open() { click(button(render(), '답변 템플릿 불러오기')); await settle(); }
function reload() { mocks.recovery = mocks.persisted; mocks.value = null; mocks.states = []; }
function restore() { (nodes(render()).find(node => typeof node.props.onRestore === 'function')!.props.onRestore as () => void)(); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.value = null; mocks.recovery = null; mocks.persisted = null;
  mocks.list.mockResolvedValue({ ok: true, data: { rows, total: 2, page: 1 } }); });

it('공유 템플릿 여러 편집을 새로고침 후 명시 복구하며 오래된 버전을 바꾸지 않는다', async () => {
  await open(); edit('기존 A'); change('템플릿 내용', 'A 보존 문구'); edit('기존 B'); change('템플릿 제목', 'B 보존 제목');
  reload(); await open(); expect(button(render(), '템플릿 등록').props.disabled).toBe(true); restore();
  expect(input(render(), '템플릿 제목').props.value).toBe('B 보존 제목'); edit('기존 A');
  expect(input(render(), '템플릿 내용').props.value).toBe('A 보존 문구');
  mocks.save.mockResolvedValueOnce({ ok: false, error: '다른 작업에서 변경했습니다.', uncertain: false }); submit(); await settle();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ id: rows[0].id, revision: 1, body: 'A 보존 문구' });
  expect(input(render(), '템플릿 내용').props.value).toBe('A 보존 문구'); expect(mocks.persisted!.pending).toBeNull();
});
it('응답 불명확·새로고침 후 자동 재전송 없이 현재 저장본을 확인하고 일치한 초안만 정리한다', async () => {
  await open(); edit('기존 B'); change('템플릿 제목', '다른 초안'); edit('기존 A'); change('템플릿 내용', '서버에 저장된 문구');
  mocks.save.mockRejectedValueOnce(new Error('response lost')); submit(); await settle();
  reload(); await open(); restore(); expect(button(render(), '템플릿 저장').props.disabled).toBe(true); expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.latest.mockResolvedValueOnce({ ok: true, template: { ...rows[0], body: '서버에 저장된 문구', revision: 2 } });
  click(button(render(), '이전 저장 결과 · 최신 저장본 확인')); await settle();
  expect(mocks.latest).toHaveBeenCalledWith({ id: rows[0].id, surface: 'review' });
  expect(Object.keys(mocks.persisted!.drafts)).toEqual([rows[1].id]);
  expect(input(render(), '템플릿 내용').props.value).toBe('서버에 저장된 문구'); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('다른 저장본을 읽어도 편집 문구는 유지하고 명시 교체 전에는 최신 revision으로 바꾸지 않는다', async () => {
  await open(); edit('기존 A'); change('템플릿 내용', '내 미저장 문구');
  mocks.latest.mockResolvedValueOnce({ ok: true, template: { ...rows[0], body: '다른 운영자 최신 문구', revision: 2 } });
  click(button(render(), '최신 저장본 비교')); await settle();
  expect(input(render(), '템플릿 내용').props.value).toBe('내 미저장 문구'); expect(mocks.persisted!.drafts[rows[0].id].revision).toBe(1);
  click(button(render(), '편집 문구를 최신 저장본으로 바꾸기'));
  expect(input(render(), '템플릿 내용').props.value).toBe('다른 운영자 최신 문구'); expect(mocks.persisted).toBeNull();
});
it('저장 완료 뒤 목록 실패에서도 저장한 초안을 다시 불확실 요청으로 남기지 않는다', async () => {
  await open(); edit('기존 A'); change('템플릿 내용', '저장 완료 문구');
  mocks.save.mockResolvedValueOnce({ ok: true, template: { ...rows[0], body: '저장 완료 문구', revision: 2 } });
  mocks.list.mockRejectedValueOnce(new Error('list lost')); submit(); await settle();
  expect(mocks.persisted).toBeNull(); expect(text(render())).toContain('저장본은 확인했지만'); expect(button(render(), '템플릿 저장').props.disabled).toBe(false);
});
/* R3(MD-0011): 리뷰·상품문의 답변도 같은 대체 동작과 안내 문구를 쓴다. */
it('작성 중인 답글이 있으면 확인 뒤에만 템플릿으로 바꾸고, 비어 있으면 바로 바꾼다', async () => {
  const onInsert = vi.fn(); const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { confirm });
  const draw = (body: string) => { mocks.index = 0; return CsReplyTemplateTools({ accountId: 'staff', surface: 'review', body, onInsert }) as Element; };
  click(button(draw('미저장 리뷰 답글'), '답변 템플릿 불러오기')); await settle();
  expect(text(draw('미저장 리뷰 답글'))).toContain('템플릿을 고르면 작성 중인 내용을 템플릿으로 바꿉니다.');
  const pick = (body: string) => click(button(nodes(draw(body)).find(node => node.type === 'article' && text(node).includes('기존 A'))!, '불러오기'));
  pick('미저장 리뷰 답글');
  expect(confirm).toHaveBeenCalledWith('작성 중인 내용을 템플릿으로 바꿀까요?');
  expect(onInsert).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); pick('미저장 리뷰 답글');
  expect(onInsert).toHaveBeenLastCalledWith('A 본문');
  mocks.states = []; confirm.mockClear();
  click(button(draw(''), '답변 템플릿 불러오기')); await settle(); pick('');
  expect(confirm).not.toHaveBeenCalled();
  expect(onInsert).toHaveBeenLastCalledWith('A 본문');
  vi.unstubAllGlobals();
});
