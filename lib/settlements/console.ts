import { parseSettlementAccountKey } from './accounts';
import { isSettlementDate, parseSettlementQuery, type SettlementDateType, type SettlementMode, type SettlementQuery } from './types';

export const PG_SETTLEMENT_PATH = '/admin/settlements';
export const PG_SETTLEMENT_TABS = ['daily', 'transactions', 'fees'] as const;
export type PgSettlementTab = typeof PG_SETTLEMENT_TABS[number];
export type PgSettlementFilters = SettlementQuery & {
  account: string | null; mode: SettlementMode; tab: PgSettlementTab; page: number; pageSize: 20 | 50 | 100;
  kind: 'all' | 'approval' | 'cancel'; match: 'all' | 'matched' | 'unlinked' | 'mismatch';
  query: string; currency: string; importId: string | null; rangeError: string | null;
};
type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === 'string' ? value : value?.[0] ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePgSettlementFilters(params: Params, now = new Date()): PgSettlementFilters {
  const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const startDate = first(params.from) || `${today.slice(0, 7)}-01`;
  const endDate = first(params.to) || today;
  const dateType: SettlementDateType = first(params.dateField) === 'soldDate' ? 'soldDate' : 'paidOutDate';
  const range = parseSettlementQuery({ dateType, startDate, endDate });
  const rawPage = first(params.page);
  const page = /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  const rawTab = first(params.tab), rawKind = first(params.kind), rawMatch = first(params.match);
  const account = first(params.account);const accountValid = !account || Boolean(parseSettlementAccountKey(account));
  const rawCurrency = first(params.currency), rawImport = first(params.import);
  return {
    account: account || null, dateType, startDate, endDate, mode: first(params.mode) === 'test' ? 'test' : 'live',
    tab: PG_SETTLEMENT_TABS.includes(rawTab as PgSettlementTab) ? rawTab as PgSettlementTab : 'daily', page,
    pageSize: first(params.pageSize) === '50' ? 50 : first(params.pageSize) === '100' ? 100 : 20,
    kind: rawKind === 'approval' || rawKind === 'cancel' ? rawKind : 'all',
    match: rawMatch === 'matched' || rawMatch === 'unlinked' || rawMatch === 'mismatch' ? rawMatch : 'all',
    query: first(params.query).trim().slice(0, 100), currency: /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : '',
    importId: UUID.test(rawImport) ? rawImport : null,
    rangeError: !accountValid ? '정산 계정을 다시 선택해주세요.' : range ? null : !isSettlementDate(startDate) || !isSettlementDate(endDate)
      ? '조회 시작일과 종료일을 올바른 날짜로 입력해주세요.' : '조회기간은 시작일부터 최대 31일로 선택해주세요.',
  };
}

export function pgSettlementHref(filters: PgSettlementFilters, patch: Partial<PgSettlementFilters> = {}): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams({ tab: next.tab, mode: next.mode, dateField: next.dateType, from: next.startDate, to: next.endDate });
  if (next.account) params.set('account', next.account);
  if (next.kind !== 'all') params.set('kind', next.kind);
  if (next.match !== 'all') params.set('match', next.match);
  if (next.query) params.set('query', next.query);
  if (next.currency) params.set('currency', next.currency);
  if (next.importId) params.set('import', next.importId);
  if (next.page > 1) params.set('page', String(next.page));
  if (next.pageSize !== 20) params.set('pageSize', String(next.pageSize));
  return `${PG_SETTLEMENT_PATH}?${params}`;
}

export const settlementFailureLabels: Record<string, string> = {
  invalid_request: '조회 기간과 수집 기준을 확인해주세요.',
  invalid_response: 'PG 자료의 형식이나 날짜를 확인하지 못했습니다. 다시 수집해주세요.',
  merchant_mismatch: '연결된 상점과 PG 자료의 상점이 다릅니다. 운영 연결 정보를 확인해주세요.',
  duplicate_transaction: '같은 거래가 중복되어 수집을 완료하지 않았습니다. 다시 수집해주세요.',
  provider_unavailable: 'PG 자료를 받지 못했습니다. 잠시 뒤 이어서 수집해주세요.',
  provider_credentials: 'PG 조회 권한을 확인하지 못했습니다. 운영 연결 정보를 확인해주세요.',
  response_too_large: 'PG 응답이 수집 크기 제한을 넘었습니다. 조회기간을 줄여주세요.',
  page_limit: '수집할 자료가 20,000건을 넘습니다. 조회기간을 줄여주세요.',
  source_changed: '두 번 조회한 PG 자료가 달라 완료하지 않았습니다. 새로 수집해주세요.',
  snapshot_changed: '두 번 조회한 PG 자료가 달라 완료하지 않았습니다. 새로 수집해주세요.',
  scope_changed: '수집을 시작한 연결 정보가 변경되었습니다. 새로 수집해주세요.',
  expired: '수집 재개 기한이 지났습니다. 새로 수집해주세요.',
};
export function settlementFailureLabel(code: string | null | undefined) {
  return code ? settlementFailureLabels[code] ?? '수집 결과를 확인하지 못했습니다. 현재 상태를 다시 확인해주세요.' : null;
}
