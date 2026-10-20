import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CsTemplateWorkspace } from '@/lib/admin/cs-editor-drafts';
const mocks = vi.hoisted(() => ({ list: vi.fn(), mutate: vi.fn(), read: vi.fn(), latest: vi.fn(), states: [] as unknown[], index: 0,
  draftValue: null as CsTemplateWorkspace | null, recoveryValue: null as CsTemplateWorkspace | null, persisted: null as CsTemplateWorkspace | null }));
vi.mock('@/components/admin/useCsEditorDraft', () => ({ useCsEditorDraft: () => ({ value: mocks.draftValue, recovery: mocks.recoveryValue,
  ready: true, blocked: false, unavailable: false, saved: Boolean(mocks.persisted),
  change: (value: CsTemplateWorkspace | null) => { mocks.draftValue = value; mocks.persisted = value; mocks.recoveryValue = null; return true; },
  restore: () => { mocks.draftValue = mocks.recoveryValue; mocks.recoveryValue = null; return mocks.draftValue; },
  discard: () => { mocks.draftValue = null; mocks.recoveryValue = null; mocks.persisted = null; },
}) }));
vi.mock('@/app/admin/inquiry-reply-template-actions', () => ({ listInquiryReplyTemplatesAction: mocks.list, mutateInquiryReplyTemplateAction: mocks.mutate,
  readInquiryTemplateOperationAction: mocks.read, readInquiryReplyTemplateAction: mocks.latest }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  } };
});
import { InquiryReplyTemplateTools } from './InquiryReplyTemplateTools';
type Element = ReactElement<Record<string, unknown>>;
const rows = [{ id: '10000000-0000-4000-8000-000000000001', category: 'other', title: '기존 A', body: 'A 본문', revision: 1, archivedAt: null, updatedAt: '2026-10-13T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000002', category: 'shipping', title: '기존 B', body: 'B 본문', revision: 1, archivedAt: null, updatedAt: '2026-10-13T00:00:00Z' }];
function render() { mocks.index = 0; return InquiryReplyTemplateTools({ body: '고객별 미저장 답변', onInsert: vi.fn() }) as Element; }
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function button(root: ReactNode, label: string) { const result = nodes(root).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!result) throw new Error(`Missing button ${label}`); return result; }
function click(node: Element) { (node.props.onClick as () => void)(); }
function change(root: ReactNode, label: string, value: string) {
  const wrapper = nodes(root).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label));
  const input = wrapper && nodes(wrapper).find(node => node.type === 'input' || node.type === 'textarea');
  if (!input) throw new Error(`Missing field ${label}`);
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
function fieldValue(root: ReactNode, label: string) {
  const wrapper = nodes(root).find(node => node.type === 'label' && text(node.props.children as ReactNode).startsWith(label));
  return wrapper && nodes(wrapper).find(node => node.type === 'input' || node.type === 'textarea')?.props.value;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function open() { click(button(render(), '답변 템플릿 불러오기')); await settle(); }
function submit() {
  const form = nodes(render()).find(node => node.type === 'form' && node.props.className === 'admin-cs-template__editor');
  (form!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
}
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.draftValue = null; mocks.recoveryValue = null; mocks.persisted = null; mocks.list.mockResolvedValue({ data: { rows, total: 2, page: 1 } }); });
it('검색·창 닫기·다른 템플릿 편집 이후에도 미저장 초안을 보존한다', async () => {
  await open();
  const articleA = nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 A'))!;
  click(button(articleA, '수정')); change(render(), '템플릿 내용', 'A 미저장 문구');
  const articleB = nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 B'))!;
  click(button(articleB, '수정')); change(render(), '템플릿 제목', 'B 미저장 제목');
  const dialog = nodes(render()).find(node => typeof node.type === 'function' && node.props.title === '고객문의 답변 템플릿')!;
  (dialog.props.onClose as () => void)(); await open();
  expect(fieldValue(render(), '템플릿 제목')).toBe('B 미저장 제목');
  click(button(nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 A'))!, '수정'));
  expect(fieldValue(render(), '템플릿 내용')).toBe('A 미저장 문구');
  const search = nodes(render()).find(node => node.type === 'form' && node.props.className === 'admin-cs-template__search')!;
  (search.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); await settle();
  expect(fieldValue(render(), '템플릿 내용')).toBe('A 미저장 문구');
});
it('전송 불명확 시 입력을 잠그고 미저장 조회 후 같은 operation으로 재시도한다', async () => {
  await open(); click(button(render(), '템플릿 등록')); change(render(), '템플릿 제목', '새 문구');
  mocks.mutate.mockRejectedValueOnce(new Error('transport lost'));
  submit(); await settle();
  expect(button(render(), '템플릿 저장').props.disabled).toBe(true);
  expect(fieldValue(render(), '템플릿 내용')).toBe('고객별 미저장 답변');
  mocks.read.mockResolvedValueOnce({ receipt: null }); click(button(render(), '같은 요청의 저장 결과 확인')); await settle();
  expect(button(render(), '템플릿 저장').props.disabled).toBe(false);
  mocks.mutate.mockResolvedValueOnce({ error: '명시적으로 거부됨', uncertain: false }); submit(); await settle();
  expect(mocks.mutate.mock.calls[1][0]).toEqual(mocks.mutate.mock.calls[0][0]);
});
it('저장 후 목록 전송 실패는 완료된 저장을 불확실 상태로 바꾸지 않는다', async () => {
  await open(); click(button(render(), '템플릿 등록')); change(render(), '템플릿 제목', '저장한 문구');
  mocks.mutate.mockImplementationOnce(async input => ({ receipt: { operationId: input.operationId, templateId: input.templateId, action: 'save', template: { ...rows[0], id: input.templateId, title: '저장한 문구', body: input.values.body } } }));
  mocks.list.mockRejectedValueOnce(new Error('list lost')); submit(); await settle();
  expect(text(render())).toContain('변경은 저장됐지만');
  expect(button(render(), '템플릿 저장').props.disabled).toBe(false);
  expect(text(render())).not.toContain('같은 요청의 저장 결과 확인');
});

function restoreAfterReload() {
  mocks.recoveryValue = mocks.persisted; mocks.draftValue = null; mocks.states = [];
}
function recover() {
  const notice = nodes(render()).find(node => typeof node.props.onRestore === 'function')!;
  (notice.props.onRestore as () => void)();
}
it('새로고침 후 명시 복구로 서로 다른 템플릿의 편집을 되살리고 저장한 초안만 제거한다', async () => {
  await open();
  click(button(nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 A'))!, '수정'));
  change(render(), '템플릿 내용', 'A 복구할 문구');
  click(button(nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 B'))!, '수정'));
  change(render(), '템플릿 제목', 'B 복구할 제목');
  restoreAfterReload(); await open();
  expect(fieldValue(render(), '템플릿 내용')).toBeUndefined(); expect(button(render(), '템플릿 등록').props.disabled).toBe(true);
  recover(); expect(fieldValue(render(), '템플릿 제목')).toBe('B 복구할 제목');
  click(button(nodes(render()).find(node => node.type === 'article' && text(node).includes('기존 A'))!, '수정'));
  expect(fieldValue(render(), '템플릿 내용')).toBe('A 복구할 문구');
  mocks.mutate.mockImplementationOnce(async input => ({ receipt: { operationId: input.operationId, templateId: input.templateId, action: 'save', template: { ...rows[0], body: input.values.body, revision: 2 } } }));
  submit(); await settle();
  expect(Object.keys(mocks.persisted!.drafts)).toEqual([rows[1].id]);
  expect(mocks.persisted!.drafts[rows[1].id].title).toBe('B 복구할 제목');
});
it('저장 결과 불명확 상태를 새로고침해도 원래 operation을 확인하기 전에는 편집·재저장하지 않는다', async () => {
  await open(); click(button(render(), '템플릿 등록')); change(render(), '템플릿 제목', '불명확 저장');
  mocks.mutate.mockRejectedValueOnce(new Error('response lost')); submit(); await settle();
  const original = mocks.mutate.mock.calls[0][0];
  restoreAfterReload(); await open(); recover();
  expect(button(render(), '템플릿 저장').props.disabled).toBe(true);
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  mocks.read.mockResolvedValueOnce({ receipt: null }); click(button(render(), '같은 요청의 저장 결과 확인')); await settle();
  expect(mocks.read).toHaveBeenCalledWith(original.operationId);
  mocks.mutate.mockResolvedValueOnce({ error: '버전 충돌', uncertain: false }); submit(); await settle();
  expect(mocks.mutate.mock.calls[1][0]).toEqual(original);
  expect(fieldValue(render(), '템플릿 제목')).toBe('불명확 저장');
  expect(mocks.persisted!.pending).toBeNull();
});
