import { beforeEach, expect, it, vi } from 'vitest';
import type { CsReplyDraft } from '@/lib/admin/cs-editor-drafts';
import type { CsReplySource } from '@/lib/admin/cs-reply-sources';
import type { CsReplyOperation } from '@/lib/admin/cs-reply-mutations';
const mocks = vi.hoisted(() => ({ read: vi.fn(), readOperation: vi.fn(), save: vi.fn(), states: [] as unknown[], index: 0,
  effects: [] as (() => void)[], cleanups: [] as (void | (() => void))[], dependencies: [] as unknown[][], effectIndex: 0, callbacks: [] as { deps: unknown[]; value: unknown }[], callbackIndex: 0,
  value: null as CsReplyDraft | null, recovery: null as CsReplyDraft | null, active: true, storageSaved: true,
  isActive: vi.fn(), discard: vi.fn(), restore: vi.fn(), change: vi.fn() }));
vi.mock('@/app/admin/cs-draft-actions', () => ({ readCsReplySourceAction: mocks.read, readCsReplyOperationAction: mocks.readOperation }));
vi.mock('./useCsEditorDraft', () => ({ useCsEditorDraft: () => ({ value: mocks.value, recovery: mocks.recovery, ready: true, blocked: !mocks.active,
  unavailable: !mocks.storageSaved, saved: Boolean(mocks.value), getCurrentSnapshot: () => ({ saved: mocks.storageSaved && Boolean(mocks.value) }), discard: mocks.discard, restore: mocks.restore, change: mocks.change, isActive: mocks.isActive }) }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  }, useRef: (initial: unknown) => {
    const index = mocks.index++; if (!(index in mocks.states)) mocks.states[index] = { current: initial }; return mocks.states[index];
  }, useCallback: (value: unknown, deps: unknown[]) => {
    const index = mocks.callbackIndex++, old = mocks.callbacks[index];
    if (!old || deps.some((dep, at) => dep !== old.deps[at])) mocks.callbacks[index] = { deps, value };
    return mocks.callbacks[index].value;
  }, useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const index = mocks.effectIndex++;
    if (!mocks.dependencies[index] || dependencies.some((value, position) => value !== mocks.dependencies[index][position])) {
      mocks.dependencies[index] = dependencies;
      mocks.effects.push(() => { const cleanup = mocks.cleanups[index]; if (cleanup) cleanup(); mocks.cleanups[index] = effect(); });
    }
  } };
});
import { useCsReplyDraft } from './useCsReplyDraft';
const accountId = '33333333-3333-4333-8333-333333333333';
const source: CsReplySource = { id: '11111111-1111-4111-8111-111111111111', surface: 'review', body: '현재 고객 원문', reply: '기존 답글', replyAt: null, status: 'visible', sourceVersion: 'legacy1' };
const fresh = { ...source, revision: '1', sourceVersion: 'reply:1' };
function Harness(initialSource = source, enabled = true) {
  // This function drives the mocked hook runtime; it is never rendered by React.
  mocks.index = 0; mocks.effectIndex = 0; mocks.callbackIndex = 0;
  const result = useCsReplyDraft({ accountId, initialSource, enabled, saveAction: mocks.save });
  mocks.effects.splice(0).forEach(effect => effect()); return result;
}
async function ready() { Harness(); await Promise.resolve(); await Promise.resolve(); return Harness(); }
function receipt(operation: CsReplyOperation) { return { ...operation, revision: String(BigInt(operation.expectedRevision)+BigInt(1)), changed: true, savedAt: '2026-10-14T00:00:00Z' }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.effects = []; mocks.cleanups = []; mocks.dependencies = []; mocks.callbacks = []; mocks.active = true; mocks.storageSaved = true; mocks.value = null; mocks.recovery = null;
  mocks.isActive.mockImplementation(() => mocks.active);
  mocks.read.mockResolvedValue({ ok: true, accountId, source: fresh });
  mocks.readOperation.mockResolvedValue({ ok: true, accountId, receipt: null });
  mocks.discard.mockImplementation(() => { mocks.value = null; mocks.recovery = null; });
  mocks.restore.mockImplementation(() => { mocks.value = mocks.recovery; mocks.recovery = null; return mocks.value; });
  mocks.change.mockImplementation(value => { if (!mocks.active) return false; mocks.value = value; mocks.recovery = null; return true; });
  mocks.save.mockImplementation(async (_state, form: FormData) => ({ replyOutcome: { kind: 'saved', receipt: receipt({ operationId: form.get('operationId') as string,
    accountId, id: source.id, surface: 'review', body: form.get('reply') as string, expectedRevision: form.get('expectedRevision') as string }) } }));
});
it('편집을 열 때 현재 context를 읽고 성공 전에는 저장을 막는다', async () => {
  const initial = Harness(); expect(initial.editingLocked).toBe(true); await initial.submit(); expect(mocks.save).not.toHaveBeenCalled();
  await Promise.resolve(); await Promise.resolve(); expect(Harness().editingLocked).toBe(false);
  expect(mocks.read).toHaveBeenCalledWith({ id: source.id, surface: 'review' });
});
it('최신 저장본 조회 중 다른 문의로 이동해도 이전 문의를 다시 열 수 있고 늦은 응답은 무시한다', async () => {
  let finishRead: ((value: unknown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  Harness(); await Promise.resolve(); expect(Harness().checking).toBe(true);
  Harness(source, false); await Promise.resolve();
  expect(Harness(source, false).checking).toBe(false);
  finishRead!({ ok: false, error: '이전 조회의 늦은 오류' });
  await Promise.resolve(); await Promise.resolve();
  expect(Harness(source, false).sourceError).toBe('');
  Harness(); await Promise.resolve(); await Promise.resolve();
  expect(Harness()).toMatchObject({ checking: false, editingLocked: false, sourceError: '' });
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('초안 복구는 최신 원문과 비교하고 구버전 초안은 명시 확인 전 제출하지 않는다', async () => {
  mocks.recovery = { body: '보관한 문구', sourceVersion: 'legacy1' }; await ready(); await Harness().restore();
  expect(Harness()).toMatchObject({ body: '보관한 문구', changedSource: true }); await Harness().submit(); expect(mocks.save).not.toHaveBeenCalled();
  Harness().acknowledge(); expect(Harness().changedSource).toBe(false);
});
it('충돌은 문구를 유지하고 최신본을 읽어 다시 비교한다', async () => {
  (await ready()).change('내 답글');
  mocks.save.mockResolvedValueOnce({ replyOutcome: { kind: 'conflict', error: '변경됨' }, errors: { form: '변경됨' } });
  mocks.read.mockResolvedValueOnce({ ok: true, accountId, source: { ...fresh, revision: '2', sourceVersion: 'reply:2', reply: '다른 운영자 답변' } });
  await Harness().submit();
  expect(Harness()).toMatchObject({ body: '내 답글', changedSource: true, hasUnresolvedOperation: false });
  expect(mocks.discard).not.toHaveBeenCalled();
});
it.each(['rejected', 'conflict', 'uncertain'])('결과 없음 뒤 %s도 선행 저장을 실패로 단정하지 않고 같은 요청과 입력 잠금을 유지한다', async kind => {
  (await ready()).change('응답이 유실된 문구'); mocks.save.mockRejectedValueOnce(new Error('offline')); await Harness().submit();
  const original = mocks.value!.pending!;
  expect(Harness().editingLocked).toBe(true); Harness().change('덮기 시도'); Harness().discard();
  expect(mocks.value!.pending).toEqual(original);
  mocks.save.mockResolvedValueOnce({ replyOutcome: { kind, error: '재시도 결과' }, errors: { form: '재시도 결과' } });
  await Harness().retry();
  expect(mocks.readOperation).toHaveBeenCalledWith(original); expect(mocks.value!.pending).toEqual(original);
  expect(Harness()).toMatchObject({ hasUnresolvedOperation: true, editingLocked: true, body: original.body });
  const form = mocks.save.mock.calls[1][1] as FormData;
  expect(form.get('operationId')).toBe(original.operationId); expect(form.get('expectedRevision')).toBe('1'); expect(form.get('reply')).toBe(original.body);
  mocks.readOperation.mockResolvedValueOnce({ ok: true, accountId, receipt: receipt(original) }); await Harness().retry();
  expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.discard).toHaveBeenCalledOnce(); expect(mocks.value).toBeNull();
});
it('성공 영수증이 다른 문구를 가리키면 초안과 미확정 요청을 유지한다', async () => {
  (await ready()).change('내 답글'); mocks.save.mockRejectedValueOnce(new Error('offline')); await Harness().submit();
  const original = mocks.value!.pending!;
  mocks.readOperation.mockResolvedValueOnce({ ok: true, accountId, receipt: { ...receipt(original), body: '다른 문구' } });
  await Harness().retry(); expect(mocks.discard).not.toHaveBeenCalled(); expect(mocks.value!.pending).toEqual(original);
});
it('미확정 요청을 저장소에 보관하지 못하면 서버 전송 없이 입력을 유지한다', async () => {
  (await ready()).change('보관에 실패한 작성 문구'); mocks.storageSaved = false; await Harness().submit();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.value).toEqual({ body: '보관에 실패한 작성 문구', sourceVersion: 'reply:1' });
  expect(Harness().state.errors?.form).toContain('답변은 전송하지 않았습니다');
});
it('미확정 요청을 복구한 경우 삭제된 원문의 읽기 실패도 요청을 지우지 않는다', async () => {
  mocks.recovery = { body: '저장 중이던 문구', sourceVersion: 'reply:1', pending: { accountId, id: source.id, surface: 'review', body: '저장 중이던 문구', expectedRevision: '1', operationId: '44444444-4444-4444-8444-444444444444' } };
  await ready(); await Harness().restore(); const original = mocks.value!.pending!;
  mocks.readOperation.mockResolvedValueOnce({ ok: true, accountId, receipt: receipt(original) });
  mocks.read.mockResolvedValueOnce({ ok: false, error: '원문 삭제됨' }); await Harness().retry();
  expect(mocks.discard).toHaveBeenCalledOnce(); expect(Harness().sourceError).toBe('원문 삭제됨');
});
it('계정 변경 뒤 늦은 저장 응답으로 새 세션의 초안을 지우지 않는다', async () => {
  (await ready()).change('계정 전환 전 답글'); let complete: ((value: unknown) => void) | undefined;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const work = Harness().submit(); const original = mocks.value!.pending!; mocks.active = false; complete!({ replyOutcome: { kind: 'saved', receipt: receipt(original) } });
  await work; expect(mocks.discard).not.toHaveBeenCalled(); expect(Harness().editingLocked).toBe(true);
});
it('새 페이지가 도착하면 이전 context는 편집 허가에 사용하지 않는다', async () => {
  await ready(); const next = Harness({ ...source, sourceVersion: 'legacy2', reply: '새 페이지 답변' });
  expect(next.editingLocked).toBe(true); expect(next.source.reply).toBe('새 페이지 답변');
});
