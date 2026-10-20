import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeClaimContact, fetchAdminClaimContactHistory, fetchClaimContactContext, fetchMyClaimContactHistory,
  readOrSealClaimContactOperation, recordClaimReshipmentV2, type ClaimContactClientIdentity, type ClaimContactClientOptions,
} from './client';
import { claimContactError, type ErrorResponse, type HistoryResponse, type OperationResponse } from './contracts';
import { CLAIM_CONTACT_FIXTURE_IDS as ids, claimContactContractFixtures } from './test-fixtures';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0' };
const json = (value: unknown, status = 200, responseHeaders: Record<string, string> = headers) => new Response(JSON.stringify(value), { status, headers: responseHeaders });
const expectedIdentity: ClaimContactClientIdentity = { actorId: ids.actor, sessionId: ids.session };
const options: ClaimContactClientOptions = { expectedIdentity };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function unknownOutcome(value: unknown) {
  expect(value).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
}
function reshipmentResponse(): OperationResponse {
  const f = claimContactContractFixtures();
  return { ...f.OperationResponse, receipt: { ...f.OperationReceipt, command: 'reshipment', target: 'reshipment', changedFields: [] } };
}
function customerHistory(): HistoryResponse {
  const f = claimContactContractFixtures();
  return { ...f.HistoryResponse, viewerKind: 'buyer', entries: [{ ...f.HistoryEntry, actorId: null, agreement: null }] };
}

describe('claim contact browser HTTP boundary', () => {
  it('POSTs all six routes with same-origin credentials, no-store and redirect:error, retaining typed IDs', async () => {
    const f = claimContactContractFixtures();
    const cases = [
      [fetchClaimContactContext, f.ContextRequest, f.ContextResponse, '/api/admin/claim-contact/context'],
      [changeClaimContact, f.ChangeRequest, f.OperationResponse, '/api/admin/claim-contact/change'],
      [readOrSealClaimContactOperation, f.OperationRequest, f.OperationResponse, '/api/admin/claim-contact/operation'],
      [recordClaimReshipmentV2, f.ReshipmentRequest, reshipmentResponse(), '/api/admin/claim-contact/reshipment'],
      [fetchAdminClaimContactHistory, f.HistoryRequest, f.HistoryResponse, '/api/admin/claim-contact/history'],
      [fetchMyClaimContactHistory, f.HistoryRequest, customerHistory(), '/api/orders/claim-contact/history'],
    ] as const;
    for (const [call, input, response, path] of cases) {
      fetchMock.mockResolvedValueOnce(json(response));
      expect(await call(input, options)).toEqual(response);
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe(path);
      expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input) });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('normalizes only outgoing editable values and rejects malformed requests without making a request', async () => {
    const f = claimContactContractFixtures();
    fetchMock.mockResolvedValueOnce(json(f.OperationResponse));
    expect(await changeClaimContact({ ...f.ChangeRequest, contact: { ...f.ContactEdit, phone: '010-1234-5678', address2: ' ' }, agreement: ' 고객 확인 완료 ' }, options)).toEqual(f.OperationResponse);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(f.ChangeRequest);
    for (const call of [fetchClaimContactContext, changeClaimContact, readOrSealClaimContactOperation, recordClaimReshipmentV2, fetchAdminClaimContactHistory, fetchMyClaimContactHistory]) {
      expect(await call({ requestId: ids.request, rawContact: 'invalid' }, options)).toEqual(claimContactError('invalid_claim_contact_request', ids.request));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires an actual no-store directive and JSON response type even for errors', async () => {
    const f = claimContactContractFixtures();
    const invalidHeaders: Record<string, string>[] = [
      { 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-cache' },
      { 'Content-Type': 'application/json', 'Cache-Control': 'x-no-store' },
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store=false' },
      { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      { 'Cache-Control': 'no-store' },
    ];
    for (const responseHeaders of invalidHeaders) {
      fetchMock.mockResolvedValueOnce(json(f.ContextResponse, 200, responseHeaders));
      unknownOutcome(await fetchClaimContactContext(f.ContextRequest, options));
    }
    fetchMock.mockResolvedValueOnce(json(claimContactError('claim_contact_changed', ids.request), 409, { 'Content-Type': 'application/json' }));
    unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    fetchMock.mockResolvedValueOnce(json(f.ContextResponse, 200, { 'Content-Type': 'APPLICATION/JSON', 'Cache-Control': 'Private, NO-STORE' }));
    expect(await fetchClaimContactContext(f.ContextRequest, options)).toEqual(f.ContextResponse);
  });

  it('rejects wrong request/order/claim/target/command and current identity rather than returning PII', async () => {
    const f = claimContactContractFixtures();
    for (const altered of [
      { ...f.ContextResponse, requestId: ids.operation }, { ...f.ContextResponse, orderId: ids.claim },
      { ...f.ContextResponse, claimId: ids.order }, { ...f.ContextResponse, target: 'reshipment' },
      { ...f.ContextResponse, command: 'reshipment', target: 'reshipment' },
      { ...f.ContextResponse, actorId: ids.order }, { ...f.ContextResponse, sessionId: ids.order },
      { ...f.ContextResponse, unrecognizedField: 'private input' },
    ]) {
      fetchMock.mockResolvedValueOnce(json(altered));
      unknownOutcome(await fetchClaimContactContext(f.ContextRequest, options));
    }
  });

  it('validates operation identity/scope and immutable expected metadata before accepting a receipt', async () => {
    const f = claimContactContractFixtures();
    for (const receipt of [
      { ...f.OperationReceipt, operationId: ids.order }, { ...f.OperationReceipt, orderId: ids.claim },
      { ...f.OperationReceipt, claimId: ids.order }, { ...f.OperationReceipt, target: 'reshipment' },
      { ...f.OperationReceipt, command: 'reshipment', target: 'reshipment', changedFields: [] },
    ]) {
      fetchMock.mockResolvedValueOnce(json({ ...f.OperationResponse, receipt }));
      unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    }
    fetchMock.mockResolvedValueOnce(json({ ...f.OperationResponse, receipt: { ...f.OperationReceipt, expectedClaimRevision: 4, resultClaimRevision: 5 } }));
    unknownOutcome(await readOrSealClaimContactOperation(f.OperationRequest, options));
    fetchMock.mockResolvedValueOnce(json({ ...f.OperationResponse, receipt: null }));
    expect(await readOrSealClaimContactOperation(f.OperationRequest, options)).toEqual({ ...f.OperationResponse, receipt: null });
    for (const call of [changeClaimContact, recordClaimReshipmentV2]) {
      fetchMock.mockResolvedValueOnce(json({ ...f.OperationResponse, receipt: null }));
      unknownOutcome(await call(call === changeClaimContact ? f.ChangeRequest : f.ReshipmentRequest, options));
    }
    fetchMock.mockResolvedValueOnce(json({ ...f.OperationResponse, receipt: null }));
    unknownOutcome(await readOrSealClaimContactOperation({ ...f.OperationRequest, sealIfAbsent: true }, options));
  });

  it('binds history ownership and endpoint viewer kind while preserving all safe response metadata', async () => {
    const f = claimContactContractFixtures();
    for (const altered of [{ ...f.HistoryResponse, orderId: ids.claim }, { ...f.HistoryResponse, claimId: ids.order }, { ...f.HistoryResponse, viewerId: ids.order }, { ...f.HistoryResponse, sessionId: ids.order }, customerHistory()]) {
      fetchMock.mockResolvedValueOnce(json(altered));
      unknownOutcome(await fetchAdminClaimContactHistory(f.HistoryRequest, options));
    }
    fetchMock.mockResolvedValueOnce(json(f.HistoryResponse));
    unknownOutcome(await fetchMyClaimContactHistory(f.HistoryRequest, options));
    fetchMock.mockResolvedValueOnce(json(customerHistory()));
    expect(await fetchMyClaimContactHistory(f.HistoryRequest, options)).toEqual(customerHistory());
  });

  it('accepts fixed 409 errors but rejects wrong requestId, status, message and malformed success bodies', async () => {
    const f = claimContactContractFixtures(), conflict = claimContactError('claim_contact_changed', ids.request);
    fetchMock.mockResolvedValueOnce(json(conflict, 409));
    expect(await changeClaimContact(f.ChangeRequest, options)).toEqual(conflict);
    for (const [body, status] of [
      [{ ...conflict, requestId: ids.order }, 409], [{ ...conflict, message: 'database address=secret' }, 409],
      [conflict, 500], [conflict, 200], [f.OperationResponse, 409], [{ ok: true }, 200], [f.OperationResponse, 201],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json(body, status));
      unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    }
    const auth = claimContactError('auth_changed');
    fetchMock.mockResolvedValueOnce(json(auth, 403));
    expect(await changeClaimContact(f.ChangeRequest, options)).toEqual(auth);
    const inputError = claimContactError('invalid_claim_contact_request');
    fetchMock.mockResolvedValueOnce(json(inputError, 413));
    expect(await changeClaimContact(f.ChangeRequest, options)).toEqual(inputError);
  });

  it('does not accept redirect responses or expose redirect/network exception text', async () => {
    const f = claimContactContractFixtures();
    const redirected = json(f.OperationResponse);
    Object.defineProperty(redirected, 'redirected', { value: true });
    fetchMock.mockResolvedValueOnce(redirected);
    unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    fetchMock.mockRejectedValueOnce(new TypeError('redirected to https://host/private?name=secret'));
    unknownOutcome(await recordClaimReshipmentV2(f.ReshipmentRequest, options));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('treats malformed JSON, invalid UTF-8, oversized bodies and body read errors as unknown outcomes', async () => {
    const f = claimContactContractFixtures();
    const streamFailure = new Response(new ReadableStream({ start(controller) { controller.error(new Error('raw secret body failure')); } }), { headers });
    for (const response of [
      new Response('{ secret', { headers }), new Response(new Uint8Array([0xff]), { headers }),
      new Response('x'.repeat(262_145), { headers }), streamFailure, new Response(null, { status: 204, headers }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('times out once without automatically retrying even if a mock transport ignores abort', async () => {
    vi.useFakeTimers();
    const f = claimContactContractFixtures();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = changeClaimContact(f.ChangeRequest, { ...options, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    unknownOutcome(await pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports AbortSignal before dispatch and during dispatch without persisting or retrying a raw request', async () => {
    const f = claimContactContractFixtures(), before = new AbortController();
    before.abort();
    unknownOutcome(await changeClaimContact(f.ChangeRequest, { ...options, signal: before.signal }));
    expect(fetchMock).not.toHaveBeenCalled();
    const during = new AbortController();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = recordClaimReshipmentV2(f.ReshipmentRequest, { ...options, signal: during.signal });
    during.abort();
    unknownOutcome(await pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchMock.mockRejectedValueOnce(new DOMException('secret abort reason', 'AbortError'));
    unknownOutcome(await changeClaimContact(f.ChangeRequest, options));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels a stalled response body on timeout and treats a late successful write as unresolved', async () => {
    vi.useFakeTimers();
    const f = claimContactContractFixtures(), cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers }));
    const pending = changeClaimContact(f.ChangeRequest, { ...options, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    unknownOutcome(await pending);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps outgoing operation metadata fixed while callers change their own objects', async () => {
    const f = claimContactContractFixtures();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const request = structuredClone(f.ChangeRequest), identity = { ...expectedIdentity };
    const pending = changeClaimContact(request, { expectedIdentity: identity });
    request.orderId = ids.claim; request.operationId = ids.order; request.contact.recipientName = 'later edit'; identity.actorId = ids.order;
    finish(json(f.OperationResponse));
    expect(await pending).toEqual(f.OperationResponse);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(f.ChangeRequest);
  });

  it('rejects oversized signed context and invalid timeout configuration before network dispatch', async () => {
    const f = claimContactContractFixtures();
    for (const timeoutMs of [0, -1, Infinity, NaN, 60_001]) expect(await changeClaimContact(f.ChangeRequest, { ...options, timeoutMs })).toEqual(claimContactError('invalid_claim_contact_request', ids.request));
    expect(await changeClaimContact(f.ChangeRequest, { expectedIdentity: { actorId: 'invalid', sessionId: ids.session } })).toEqual(claimContactError('auth_changed', ids.request));
    const veryLong = { ...f.ChangeRequest, signedContext: `cc1.${'A'.repeat(12_000)}.AQ`, contact: { ...f.ContactEdit, recipientName: '😀'.repeat(50), address2: '😀'.repeat(200) }, agreement: '😀'.repeat(500) };
    const result = await changeClaimContact(veryLong, options) as ErrorResponse;
    expect(result.code).toBe('invalid_claim_contact_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
