import {
  claimContactError, claimContactErrorStatus, normalizeClaimContactChangeRequest,
  normalizeClaimContactReshipmentRequest, parseClaimContactContract,
  type ClaimContactContracts, type ContextResponse, type ErrorResponse, type HistoryResponse,
  type OperationReceipt, type OperationResponse, type Uuid,
} from './contracts';

export interface ClaimContactClientIdentity { actorId: Uuid; sessionId: Uuid }
export interface ClaimContactClientOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Snapshot for this request. The caller must still discard responses from an obsolete UI/auth generation. */
  expectedIdentity?: ClaimContactClientIdentity;
}

type ResponseName = 'ContextResponse' | 'OperationResponse' | 'HistoryResponse';
type PrivateResponse = ContextResponse | OperationResponse | HistoryResponse;
type Binding = { requestId: Uuid; orderId: Uuid; claimId: Uuid };
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 262_144;

function requestIdFrom(input: unknown): Uuid | null {
  if (input === null || typeof input !== 'object') return null;
  return parseClaimContactContract('Uuid', Object.getOwnPropertyDescriptor(input, 'requestId')?.value);
}
function invalid(input: unknown): ErrorResponse {
  return claimContactError('invalid_claim_contact_request', requestIdFrom(input));
}
function privateJson(response: Response): boolean {
  return response.headers.get('cache-control')?.split(',').some(part => part.trim().toLowerCase() === 'no-store') === true
    && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json'
    && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect';
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error('response_unavailable');
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('response_unavailable');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('response_unavailable');
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (signal.aborted) throw new Error('response_unavailable');
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener('abort', cancel);
    // Discard unread response data on every failure as well as normal completion.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function identityMatches(value: PrivateResponse, identity: ClaimContactClientIdentity | undefined): boolean {
  return !identity || (('viewerId' in value ? value.viewerId : value.actorId) === identity.actorId && value.sessionId === identity.sessionId);
}
function receiptMatches(receipt: OperationReceipt, input: Binding & { operationId: Uuid }, command: 'change' | 'reshipment', target: 'collection' | 'reshipment'): boolean {
  return receipt.operationId === input.operationId && receipt.orderId === input.orderId && receipt.claimId === input.claimId
    && receipt.command === command && receipt.target === target;
}

/** One HTTP attempt only. Raw contact input lives only in this call's request body, never in a store or journal. */
async function post<Name extends ResponseName>(
  path: string, input: Binding, body: string, responseName: Name,
  bound: (value: ClaimContactContracts[Name]) => boolean, options: ClaimContactClientOptions, maxBodyBytes = 16_384,
): Promise<ClaimContactContracts[Name] | ErrorResponse> {
  const unknownOutcome = () => claimContactError('claim_contact_outcome_unknown', input.requestId);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000 || new TextEncoder().encode(body).byteLength > maxBodyBytes) return invalid(input);
  const identity = options.expectedIdentity ? { ...options.expectedIdentity } : undefined;
  if (identity && (!parseClaimContactContract('Uuid', identity.actorId) || !parseClaimContactContract('Uuid', identity.sessionId))) return claimContactError('auth_changed', input.requestId);
  if (options.signal?.aborted) return unknownOutcome();

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopWaiting: (() => void) | undefined;
  const interrupted = new Promise<ErrorResponse>(resolve => {
    stopWaiting = () => resolve(unknownOutcome());
    controller.signal.addEventListener('abort', stopWaiting, { once: true });
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  });
  const attempt = async (): Promise<ClaimContactContracts[Name] | ErrorResponse> => {
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body, signal: controller.signal,
      });
      if (controller.signal.aborted || !privateJson(response)) {
        void response.body?.cancel().catch(() => undefined);
        return unknownOutcome();
      }
      const payload = await boundedJson(response, controller.signal);
      if (controller.signal.aborted) return unknownOutcome();
      if (response.status !== 200) {
        const error = parseClaimContactContract('ErrorResponse', payload);
        const routeInputError = error?.code === 'invalid_claim_contact_request' && [400, 413, 415].includes(response.status);
        return error && (error.requestId === null || error.requestId === input.requestId)
          && (claimContactErrorStatus(error.code) === response.status || routeInputError) ? error : unknownOutcome();
      }
      const value = parseClaimContactContract(responseName, payload);
      if (!value || value.requestId !== input.requestId || !identityMatches(value, identity) || !bound(value)) return unknownOutcome();
      return value;
    } catch {
      // Network, redirect, body, UTF-8, JSON and abort failures never expose provider text.
      return unknownOutcome();
    }
  };
  try { return await Promise.race([attempt(), interrupted]); }
  finally {
    if (timeout !== undefined) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
    if (stopWaiting) controller.signal.removeEventListener('abort', stopWaiting);
  }
}

export async function fetchClaimContactContext(input: unknown, options: ClaimContactClientOptions = {}): Promise<ContextResponse | ErrorResponse> {
  const request = parseClaimContactContract('ContextRequest', input);
  if (!request) return invalid(input);
  const scope = { requestId: request.requestId, orderId: request.orderId, claimId: request.claimId, target: request.target, command: request.command };
  return post('/api/admin/claim-contact/context', scope, JSON.stringify(request), 'ContextResponse', value => value.orderId === scope.orderId
    && value.claimId === scope.claimId && value.target === scope.target && value.command === scope.command, options);
}

export async function changeClaimContact(input: unknown, options: ClaimContactClientOptions = {}): Promise<OperationResponse | ErrorResponse> {
  const request = normalizeClaimContactChangeRequest(input);
  if (!request) return invalid(input);
  const scope = { requestId: request.requestId, orderId: request.orderId, claimId: request.claimId, operationId: request.operationId, target: request.target };
  return post('/api/admin/claim-contact/change', scope, JSON.stringify(request), 'OperationResponse', value => value.receipt !== null
    && value.receipt.state !== 'sealed' && receiptMatches(value.receipt, scope, 'change', scope.target), options);
}

export async function readOrSealClaimContactOperation(input: unknown, options: ClaimContactClientOptions = {}): Promise<OperationResponse | ErrorResponse> {
  const request = parseClaimContactContract('OperationRequest', input);
  if (!request) return invalid(input);
  const scope = { ...request };
  return post('/api/admin/claim-contact/operation', scope, JSON.stringify(request), 'OperationResponse', value => value.receipt === null
    ? !scope.sealIfAbsent : receiptMatches(value.receipt, scope, scope.command, scope.target)
      && value.receipt.expectedClaimType === scope.expectedClaimType && value.receipt.expectedClaimRevision === scope.expectedClaimRevision, options);
}

export async function recordClaimReshipmentV2(input: unknown, options: ClaimContactClientOptions = {}): Promise<OperationResponse | ErrorResponse> {
  const request = normalizeClaimContactReshipmentRequest(input);
  if (!request) return invalid(input);
  const scope = { requestId: request.requestId, orderId: request.orderId, claimId: request.claimId, operationId: request.operationId };
  return post('/api/admin/claim-contact/reshipment', scope, JSON.stringify(request), 'OperationResponse', value => value.receipt !== null
    && value.receipt.state === 'saved' && receiptMatches(value.receipt, scope, 'reshipment', 'reshipment'), options, 262_144);
}

async function history(input: unknown, options: ClaimContactClientOptions, admin: boolean): Promise<HistoryResponse | ErrorResponse> {
  const request = parseClaimContactContract('HistoryRequest', input);
  if (!request) return invalid(input);
  const scope = { requestId: request.requestId, orderId: request.orderId, claimId: request.claimId };
  return post(admin ? '/api/admin/claim-contact/history' : '/api/orders/claim-contact/history', scope, JSON.stringify(request), 'HistoryResponse', value => value.orderId === scope.orderId
    && value.claimId === scope.claimId && (admin ? value.viewerKind === 'operator' : value.viewerKind !== 'operator'), options);
}
export async function fetchAdminClaimContactHistory(input: unknown, options: ClaimContactClientOptions = {}): Promise<HistoryResponse | ErrorResponse> { return history(input, options, true); }
export async function fetchMyClaimContactHistory(input: unknown, options: ClaimContactClientOptions = {}): Promise<HistoryResponse | ErrorResponse> { return history(input, options, false); }
