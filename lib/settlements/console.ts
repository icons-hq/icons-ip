import { parseSettlementAccountKey, type SettlementAccountIdentity, type SettlementAccountOption } from './accounts';
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

const DAY_MS = 86_400_000;
/** 조회기간은 시작일을 포함해 31일까지다. `parseSettlementQuery`가 받는 시작일·종료일 차이(30일)와 같아야 한다. */
export const PG_SETTLEMENT_MAX_SPAN_DAYS = 30;

/** `YYYY-MM-DD`에 일수를 더하거나 뺀 날짜. 날짜가 아니거나 허용 범위를 벗어나면 빈 글자다. */
export function addSettlementDays(day: string, days: number): string {
  if (!isSettlementDate(day)) return '';
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  return isSettlementDate(next) ? next : '';
}

/**
 * 시작일·종료일을 고르는 동안 바로 알려 줄 문제. 아직 날짜가 아니면(비어 있거나 입력 중) 말하지 않는다.
 * 종료일 입력칸이 시작일을 보고 고를 수 있는 날짜를 막으므로, 검색한 뒤에 오류로 만나지 않는다. 푸는 길은 종료일을 다시 고르는 것이다.
 */
export function pgSettlementPeriodProblem(from: string, to: string): string | null {
  if (!isSettlementDate(from) || !isSettlementDate(to)) return null;
  if (from > to) return '종료일은 시작일과 같거나 그 뒤의 날짜로 골라 주세요.';
  return Date.parse(to) - Date.parse(from) > PG_SETTLEMENT_MAX_SPAN_DAYS * DAY_MS ? '종료일은 시작일부터 31일 안에서 골라 주세요.' : null;
}

/** 주소로 들어온 잘못된 기간을 검색 결과 위에서 알리는 말. 화면 입력은 위 함수가 먼저 막는다. */
function periodError(startDate: string, endDate: string): string {
  if (!isSettlementDate(startDate) || !isSettlementDate(endDate)) return '시작일과 종료일을 올바른 날짜로 입력해 주세요.';
  return startDate > endDate ? '시작일이 종료일보다 늦습니다. 날짜를 바꿔 다시 검색해 주세요.' : '조회기간은 시작일부터 최대 31일입니다. 종료일을 줄여 다시 검색해 주세요.';
}

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
    rangeError: !accountValid ? '정산 계정을 다시 선택해주세요.' : range ? null : periodError(startDate, endDate),
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

/**
 * 정산 계정 이름. 화면에는 내부 계정 번호를 보이지 않는다 — 같은 종류(일반 결제·정기결제)가 환경마다 둘 이상일 때만 순서 번호를 붙여 가른다.
 * 번호는 정산 계정 목록의 순서다(목록이 없으면 종류 이름만).
 */
export function pgSettlementAccountName(account: SettlementAccountIdentity & { mode?: SettlementMode }, accounts: readonly SettlementAccountOption[] = []): string {
  const base = account.integration === 'toss_billing' ? '정기결제' : '일반 결제';
  const same = accounts.filter(item => item.integration === account.integration && (!account.mode || item.mode === account.mode));
  const index = same.findIndex(item => item.accountId === account.accountId);
  return same.length > 1 && index >= 0 ? `${base} ${index + 1}` : base;
}

/**
 * 결제사 자료 가져오기 화면의 버튼 이름. 안내·오류 문장이 이 이름을 그대로 가리키도록 한 곳에 둔다
 * (문장 안에서는 [이름]으로 적는다).
 */
export const SETTLEMENT_ACTIONS = {
  start: '자료 가져오기',
  resume: '이어서 가져오기',
  again: '다시 가져오기',
  check: '현재 상태 확인',
  confirmStarted: '가져왔는지 확인',
  stop: '멈추기',
  reload: '가져온 기록 다시 불러오기',
} as const;
const action = (name: keyof typeof SETTLEMENT_ACTIONS) => `[${SETTLEMENT_ACTIONS[name]}]`;

/** 가져오기 작업의 상태 이름. `running`은 이 화면이 지금 가져오는 중인지다(끝나지 않았는데 멈춰 있으면 '중간에 멈춤'). */
export function settlementJobLabel(job: { state: string; scan: number }, running = false): string {
  if (job.state === 'complete') return '가져옴';
  if (job.state === 'failed') return '가져오기 중단';
  if (!running) return '중간에 멈춤';
  return job.scan === 2 ? '확인하는 중' : '가져오는 중';
}

export const SETTLEMENT_BUSY_MESSAGE = `같은 자료를 이미 가져오는 중입니다. 잠시 뒤 ${action('check')}을 눌러 주세요.`;
export const SETTLEMENT_PAUSED_MESSAGE = `아직 다 가져오지 않았습니다. ${action('resume')}를 누르면 멈춘 곳부터 계속합니다.`;
export const SETTLEMENT_STOP_MESSAGE = `지금 하던 단계까지 마치고 멈춥니다. 나중에 ${action('resume')}로 계속할 수 있습니다.`;
export const SETTLEMENT_QUERY_MISMATCH_MESSAGE = `가져온 자료의 기간이나 계정이 지금 조회 조건과 다릅니다. ${action('check')}을 눌러 다시 확인해 주세요.`;
export const SETTLEMENT_RECOVERY_MESSAGE = `가져오기를 시작한 뒤 정산 계정이나 연결 정보가 바뀌었습니다. ${action('reload')}를 눌러 어디까지 됐는지 확인해 주세요.`;
/** 결과를 모를 때. 작업이 이미 있으면 상태를 읽고, 없으면 같은 가져오기를 한 번 더 보내 확인한다(같은 자료를 두 번 가져오지 않는다). */
export function settlementUncertainMessage(hasJob: boolean): string {
  return hasJob
    ? `가져오기 결과를 확인하지 못했습니다. ${action('check')}을 누르면 어디까지 됐는지 볼 수 있습니다.`
    : `가져왔는지 확인하지 못했습니다. ${action('confirmStarted')}을 누르면 같은 자료를 두 번 가져오지 않습니다.`;
}

export const settlementFailureLabels: Record<string, string> = {
  invalid_request: '조회기간이나 정산 계정이 올바르지 않습니다. 조건을 다시 골라 검색한 뒤 가져와 주세요.',
  invalid_response: `결제사가 보낸 자료의 형식이나 날짜를 읽지 못했습니다. ${action('again')}를 눌러 주세요.`,
  merchant_mismatch: '결제사 자료의 상점이 연결된 상점과 다릅니다. 개발 담당자에게 연결 정보를 확인해 달라고 알려 주세요.',
  duplicate_transaction: `같은 거래가 중복돼 가져오기를 끝내지 못했습니다. ${action('again')}를 눌러 주세요.`,
  provider_unavailable: `결제사에서 자료를 받지 못했습니다. 잠시 뒤 ${action('resume')}를 눌러 주세요.`,
  provider_credentials: '결제사가 조회를 허용하지 않았습니다. 개발 담당자에게 조회 권한을 확인해 달라고 알려 주세요.',
  response_too_large: '결제사가 보낸 자료가 너무 커서 가져오지 못했습니다. 조회기간을 줄여 다시 가져와 주세요.',
  page_limit: '가져올 거래가 20,000건을 넘습니다. 조회기간을 줄여 다시 가져와 주세요.',
  source_changed: `같은 자료를 두 번 읽었는데 내용이 달라 가져오기를 끝내지 못했습니다. ${action('again')}를 눌러 주세요.`,
  snapshot_changed: `같은 자료를 두 번 읽었는데 내용이 달라 가져오기를 끝내지 못했습니다. ${action('again')}를 눌러 주세요.`,
  scope_changed: `가져오기를 시작한 뒤 연결 정보가 바뀌었습니다. ${action('again')}를 눌러 새로 시작해 주세요.`,
  expired: `이어서 가져올 수 있는 기한이 지났습니다. ${action('again')}를 눌러 새로 시작해 주세요.`,
};
export function settlementFailureLabel(code: string | null | undefined) {
  return code ? settlementFailureLabels[code] ?? `가져오기 결과를 확인하지 못했습니다. ${action('check')}을 눌러 어디까지 됐는지 확인해 주세요.` : null;
}
