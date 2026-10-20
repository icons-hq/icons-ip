import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), accounts: vi.fn(), report: vi.fn(), connection: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/settlements/accounts.server', () => ({ loadSettlementAccounts: mocks.accounts }));
vi.mock('@/lib/settlements/report.server', () => ({ loadPgSettlementReport: mocks.report, pgSettlementConnectionState: mocks.connection }));
vi.mock('@/components/admin/screens/PgSettlementScreen', () => ({ PgSettlementScreen: () => null }));
import Page from './page';
const id = '287b949d-af67-4398-b0d2-09adbd123459';
beforeEach(() => { vi.clearAllMocks();mocks.accounts.mockResolvedValue([{ accountId: id, integration: 'toss_payment', mode: 'test', label: '일반 결제 · 계정' }]);mocks.report.mockResolvedValue(null);mocks.connection.mockResolvedValue({ enabled: true, mode: 'test' }); });
it('최초 일반계정 수집 후 새로고침은 등록된 opaque 계정의 결과를 조회한다', async () => {
  const page = await Page({ searchParams: Promise.resolve({ account: 'current', mode: 'test', from: '2026-10-01', to: '2026-10-31' }) });
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ account: id }));expect(mocks.connection).toHaveBeenCalledWith(id);
  expect(page.props.connection).toEqual({ enabled: true, mode: 'test' });expect(JSON.stringify(page.props)).not.toMatch(/merchantId|profileId/);
});
it('저장된 과거 계정을 선택하면 현재 연결 계정으로 대체하지 않는다', async () => {
  const oldId = '287b949d-af67-4398-b0d2-09adbd123458';
  await Page({ searchParams: Promise.resolve({ account: oldId, mode: 'test' }) });
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ account: oldId }));
});
