import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn(), serviceRpc: vi.fn(), loadRefundTransfers: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.serviceRpc }) }));
vi.mock('./refund-transfers.server', () => ({ loadRefundTransfers: mocks.loadRefundTransfers }));

import { parsePartialCancellationRefundAccounts, parseRefundTransferAccounts, refundTransferExportCaller, revealRefundTransferAccounts } from './list-export-refund-transfers.server';
import { loadAdminListExportSheet } from './list-export-data.server';
import { AdminListExportChangedError, AdminListExportLoadError } from './list-export-errors';
import { ExportRequestError } from './export-request.server';
import { REFUND_TRANSFER_EXPORT_INCLUDES_ACCOUNT } from './list-export-sheets';
import type { RefundTransferClaimRow, RefundTransferRow } from './refund-transfers';

const ACTOR = 'a0000000-0000-4000-8000-000000000001', SESSION = 'b0000000-0000-4000-8000-000000000001';
const row = (index: number, overrides: Partial<RefundTransferClaimRow> = {}): RefundTransferClaimRow => ({
  claimId: `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`, orderId: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  orderNumber: `202611111${String(index).padStart(7, '0')}`, reference: 40 + index, claimType: 'cancel', amount: 10000 * index,
  confirmedAt: '2026-11-08T03:00:00Z', filedAt: '2026-11-08T04:00:00Z', updatedAt: '2026-11-08T04:00:00Z', revision: 2, gift: false,
  payerName: `결제자${index}`, requesterName: `요청자${index}`, ...overrides,
});
const revealed = (claimId: string, number = '110-123-456789') => ({ claimId, status: 'revealed', bankName: '합성은행', accountNumber: number, accountHolder: '합성 예금주' });
const blankAccount = (claimId: string, status: 'not_filed' | 'unavailable') => ({ claimId, status, bankName: null, accountNumber: null, accountHolder: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ACTOR, session_id: SESSION } }, error: null });
});

describe('환불 송금 대기 계좌 응답 검증', () => {
  const rows = [row(1), row(2), row(3)];
  it('요청 순서·개수 그대로이고 계좌를 내준 요청만 세 값이 있는 응답을 받는다', () => {
    const accounts = parseRefundTransferAccounts({ exportId: 'export-1', rows: [revealed(rows[0].claimId), blankAccount(rows[1].claimId, 'not_filed'), blankAccount(rows[2].claimId, 'unavailable')] }, 'export-1', rows)!;
    expect([...accounts.values()].map(account => [account.status, account.accountNumber])).toEqual([['revealed', '110-123-456789'], ['not_filed', null], ['unavailable', null]]);
  });
  it.each([
    ['다른 exportId', { exportId: 'other', rows: rows.map(entry => revealed(entry.claimId)) }],
    ['빠진 요청', { exportId: 'export-1', rows: rows.slice(0, 2).map(entry => revealed(entry.claimId)) }],
    ['순서가 바뀐 요청', { exportId: 'export-1', rows: [rows[1], rows[0], rows[2]].map(entry => revealed(entry.claimId)) }],
    ['모르는 상태', { exportId: 'export-1', rows: [{ ...revealed(rows[0].claimId), status: 'masked' }, revealed(rows[1].claimId), revealed(rows[2].claimId)] }],
    ['열람인데 빈 계좌', { exportId: 'export-1', rows: [{ ...revealed(rows[0].claimId), accountNumber: ' ' }, revealed(rows[1].claimId), revealed(rows[2].claimId)] }],
    ['접수 전인데 계좌가 있음', { exportId: 'export-1', rows: [{ ...blankAccount(rows[0].claimId, 'not_filed'), bankName: '합성은행' }, revealed(rows[1].claimId), revealed(rows[2].claimId)] }],
    ['제어 문자', { exportId: 'export-1', rows: [revealed(rows[0].claimId, '110\n123'), revealed(rows[1].claimId), revealed(rows[2].claimId)] }],
    ['추가 키', { exportId: 'export-1', rows: rows.map(entry => ({ ...revealed(entry.claimId), viewId: 'v' })) }],
  ])('%s는 받지 않는다', (_label, value) => {
    expect(parseRefundTransferAccounts(value, 'export-1', rows)).toBeNull();
  });
});

describe('계좌 열람 호출', () => {
  it('쿠키 세션 사용자·claims·라우트 운영자가 같을 때만 운영자·세션을 증명한다', async () => {
    const client = { auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } };
    await expect(refundTransferExportCaller(client, ACTOR)).resolves.toEqual({ actorId: ACTOR, sessionId: SESSION });
    await expect(refundTransferExportCaller(client, 'a0000000-0000-4000-8000-000000000002')).rejects.toBeInstanceOf(ExportRequestError);
    await expect(refundTransferExportCaller(client, undefined)).rejects.toMatchObject({ status: 403 });
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'someone-else', session_id: SESSION } }, error: null });
    await expect(refundTransferExportCaller(client, ACTOR)).rejects.toMatchObject({ status: 403 });
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: ACTOR } }, error: null });
    await expect(refundTransferExportCaller(client, ACTOR)).rejects.toMatchObject({ status: 403 });
  });
  it('요청·주문·리비전만 넘기고 새 exportId로 한 번 부른다. 바뀐 목록·권한 변화·형식 오류는 파일을 만들지 않는다', async () => {
    const rows = [row(1), row(2)];
    mocks.serviceRpc.mockImplementation(async (_name: string, args: { p_export_id: string }) => ({ data: { exportId: args.p_export_id, rows: rows.map(entry => revealed(entry.claimId)) }, error: null }));
    const result = await revealRefundTransferAccounts({ actorId: ACTOR, sessionId: SESSION }, rows);
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.serviceRpc.mock.calls[0];
    expect(name).toBe('service_export_bank_transfer_refund_accounts');
    expect(args).toEqual({ p_actor_id: ACTOR, p_session_id: SESSION, p_export_id: result.exportId,
      p_claims: rows.map(entry => ({ claimId: entry.claimId, orderId: entry.orderId, revision: entry.revision })) });
    expect(result.accounts.get(rows[1].claimId)?.accountHolder).toBe('합성 예금주');
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'bank_refund_export_changed' } });
    await expect(revealRefundTransferAccounts({ actorId: ACTOR, sessionId: SESSION }, rows)).rejects.toBeInstanceOf(AdminListExportChangedError);
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'bank_refund_permission_required' } });
    await expect(revealRefundTransferAccounts({ actorId: ACTOR, sessionId: SESSION }, rows)).rejects.toMatchObject({ status: 403 });
    mocks.serviceRpc.mockResolvedValueOnce({ data: { exportId: 'wrong', rows: [] }, error: null });
    await expect(revealRefundTransferAccounts({ actorId: ACTOR, sessionId: SESSION }, rows)).rejects.toBeInstanceOf(AdminListExportLoadError);
  });
});

describe('환불 송금 대기 목록 시트 로더', () => {
  it('계좌 열은 켜져 있다(2026-11-11 사용자 결정)', () => {
    expect(REFUND_TRANSFER_EXPORT_INCLUDES_ACCOUNT).toBe(true);
  });
  it('화면과 같은 조회를 끝 페이지까지 모은 뒤 그 요청들의 계좌를 한 번 열고, 발급 기록이 그 열람을 가리킨다', async () => {
    const all = Array.from({ length: 51 }, (_, index) => row(index + 1));
    mocks.loadRefundTransfers.mockImplementation(async (page: number) => ({ rows: all.slice((page - 1) * 50, page * 50), total: all.length, page, pageSize: 50 }));
    mocks.serviceRpc.mockImplementation(async (_name: string, args: { p_export_id: string; p_claims: { claimId: string }[] }) => ({ data: {
      exportId: args.p_export_id, rows: args.p_claims.map((claim, index) => index === 1 ? blankAccount(claim.claimId, 'not_filed') : revealed(claim.claimId)),
    }, error: null }));
    const sheet = await loadAdminListExportSheet('refund-transfers', { screen: 'refund-transfers' }, new Date('2026-11-11T03:00:00Z'), ACTOR);
    expect(mocks.loadRefundTransfers.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(1);
    expect(mocks.serviceRpc.mock.calls[0][1].p_claims).toHaveLength(51);
    expect(sheet.screen).toBe('refund-transfers');
    expect(sheet.recordCount).toBe(51);
    expect(sheet.rows).toHaveLength(51);
    expect(sheet.filters).toEqual({ accountExportId: mocks.serviceRpc.mock.calls[0][1].p_export_id });
    const at = (header: string, index: number) => sheet.rows[index][sheet.columns.findIndex(column => column.header === header)];
    expect([at('은행', 0), at('계좌번호', 0), at('예금주', 0), at('계좌 상태', 0)]).toEqual(['합성은행', '110-123-456789', '합성 예금주', '확인됨']);
    expect([at('은행', 1), at('계좌번호', 1), at('계좌 상태', 1)]).toEqual([null, null, '환불 접수 전']);
  });
  it('계좌를 열기 전에 세션 운영자를 확인하고, 다르면 목록도 계좌도 읽지 않는다', async () => {
    await expect(loadAdminListExportSheet('refund-transfers', { screen: 'refund-transfers' }, new Date(), 'a0000000-0000-4000-8000-000000000009')).rejects.toMatchObject({ status: 403 });
    expect(mocks.loadRefundTransfers).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
  it('무통장 부분 취소 송금 대기는 요청 계좌 열람(요약 기록) 뒤 같은 내려받기 번호로 열고, 시트에 부분 취소 행으로 싣는다', async () => {
    const partial: RefundTransferRow = { kind: 'partial_cancellation', partialCancellationId: 'f0000000-0000-4000-8000-000000000001', orderId: row(1).orderId,
      sequence: 2, amount: 9500, confirmedAt: '2026-11-08T05:00:00Z', filedAt: '2026-11-08T05:00:00Z', updatedAt: '2026-11-08T05:00:00Z', gift: false, payerName: '결제자1' };
    mocks.loadRefundTransfers.mockResolvedValue({ rows: [row(1), partial], total: 2, page: 1, pageSize: 50 });
    mocks.serviceRpc.mockImplementation(async (name: string, args: { p_export_id: string; p_claims?: { claimId: string }[]; p_items?: { partialCancellationId: string }[] }) => ({ data: {
      exportId: args.p_export_id,
      rows: name === 'service_export_bank_transfer_refund_accounts' ? args.p_claims!.map(claim => revealed(claim.claimId))
        : args.p_items!.map(item => ({ partialCancellationId: item.partialCancellationId, status: 'revealed', bankName: '부분은행', accountNumber: '220-000-1111', accountHolder: '부분 예금주' })),
    }, error: null }));
    const sheet = await loadAdminListExportSheet('refund-transfers', { screen: 'refund-transfers' }, new Date('2026-11-11T03:00:00Z'), ACTOR);
    expect(mocks.serviceRpc.mock.calls.map(call => call[0])).toEqual(['service_export_bank_transfer_refund_accounts', 'service_export_order_partial_cancellation_refund_accounts']);
    expect(mocks.serviceRpc.mock.calls[0][1].p_claims).toHaveLength(1);
    expect(mocks.serviceRpc.mock.calls[1][1]).toEqual({ p_actor_id: ACTOR, p_session_id: SESSION, p_export_id: mocks.serviceRpc.mock.calls[0][1].p_export_id,
      p_items: [{ partialCancellationId: partial.partialCancellationId, orderId: partial.orderId }] });
    const at = (header: string, index: number) => sheet.rows[index][sheet.columns.findIndex(column => column.header === header)];
    expect([at('유형', 1), at('계좌번호', 1), at('송금 대기 금액', 1), at('요청자', 1)]).toEqual(['부분 취소', '220-000-1111', 9500, '운영자 처리']);
    expect(sheet.notes.join(' ')).toContain('재고 부족 부분 취소');
    // 부분 취소 계좌 응답이 순서·키가 다르면 파일을 만들지 않는다.
    expect(parsePartialCancellationRefundAccounts({ exportId: 'e', rows: [{ partialCancellationId: 'other', status: 'revealed', bankName: 'a', accountNumber: 'b', accountHolder: 'c' }] }, 'e', [partial])).toBeNull();
    expect(parsePartialCancellationRefundAccounts({ exportId: 'e', rows: [{ partialCancellationId: partial.partialCancellationId, status: 'not_filed', bankName: null, accountNumber: null, accountHolder: null }] }, 'e', [partial])).toBeNull();
  });
  it('목록 조회가 실패하면 계좌를 열지 않는다', async () => {
    mocks.loadRefundTransfers.mockRejectedValue(new Error('환불 송금 대기 목록을 불러오지 못했습니다.'));
    await expect(loadAdminListExportSheet('refund-transfers', { screen: 'refund-transfers' }, new Date(), ACTOR)).rejects.toBeInstanceOf(AdminListExportLoadError);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
