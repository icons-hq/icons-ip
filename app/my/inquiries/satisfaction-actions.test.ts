import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { setInquirySatisfactionAction, readInquirySatisfactionOperationAction } from './satisfaction-actions';
import { loadMyInquirySatisfaction } from '@/lib/inquiry-satisfaction.server';
import { satisfactionCompleted as completed, satisfactionCurrent as current, satisfactionIds as ids, satisfactionRequest as request } from '@/test/fixtures/inquiry-satisfaction';
beforeEach(() => vi.resetAllMocks());

it('rejects missing desire before DB access and sends full identity/CAS for an explicit withdrawal', async () => {
  const missing = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'desiredValue'));
  expect(await setInquirySatisfactionAction(missing)).toMatchObject({ ok: false, kind: 'invalid' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ error: null, data: completed });
  expect(await setInquirySatisfactionAction(request)).toEqual({ ok: true, value: completed });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('set_my_inquiry_satisfaction', {
    p_operation_id: ids.operation, p_inquiry_id: ids.inquiry, p_expected_actor_id: ids.actor, p_expected_session_id: ids.session,
    p_expected_answer_id: ids.answer, p_expected_revision: 0, p_desired_value: 'satisfied',
  });
});
it('a lost response and retry use exactly the same operation and desired state', async () => {
  mocks.rpc.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: null, data: completed });
  expect(await setInquirySatisfactionAction(request)).toMatchObject({ ok: false, kind: 'unknown' });
  expect(mocks.revalidate).not.toHaveBeenCalled();
  expect(await setInquirySatisfactionAction(request)).toMatchObject({ ok: true });
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
});
it('recovery remains a read and returns unresolved separately from an unknown timeout', async () => {
  const data = { operation: 'unresolved', receipt: null, current };
  mocks.rpc.mockResolvedValueOnce({ error: null, data }).mockRejectedValueOnce(new Error('timeout'));
  expect(await readInquirySatisfactionOperationAction(request)).toEqual({ ok: true, value: data });
  expect(mocks.rpc.mock.calls[0][0]).toBe('read_my_inquiry_satisfaction_operation');
  expect(await readInquirySatisfactionOperationAction(request)).toMatchObject({ ok: false, kind: 'unknown' });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it.each(['answer_changed', 'revision_conflict'])('CAS %s never automatically retries on a newer revision', async code => {
  mocks.rpc.mockResolvedValue({ error: { message: `inquiry_satisfaction_${code}` }, data: null });
  expect(await setInquirySatisfactionAction(request)).toMatchObject({ ok: false, kind: 'conflict' });
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('rejects unrelated receipts and does not downgrade a panel load failure to unrated', async () => {
  mocks.rpc.mockResolvedValue({ error: null, data: { ...completed, receipt: { ...completed.receipt, operationId: ids.newAnswer } } });
  expect(await setInquirySatisfactionAction(request)).toMatchObject({ ok: false, kind: 'unknown' });
  mocks.rpc.mockResolvedValue({ error: { message: 'not deployed' }, data: null });
  expect(await loadMyInquirySatisfaction(ids.inquiry)).toEqual({ ok: false });
});
it('only accepts a successful context for the requested inquiry', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: current }).mockResolvedValueOnce({ data: { ...current, inquiryId: ids.newAnswer } });
  expect(await loadMyInquirySatisfaction(ids.inquiry)).toEqual({ ok: true, value: current });
  expect(await loadMyInquirySatisfaction(ids.inquiry)).toEqual({ ok: false });
});
