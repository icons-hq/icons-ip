import { describe, expect, it } from 'vitest';
import {
  PG_SETTLEMENT_MAX_SPAN_DAYS, SETTLEMENT_ACTIONS, SETTLEMENT_BUSY_MESSAGE, SETTLEMENT_PAUSED_MESSAGE, SETTLEMENT_QUERY_MISMATCH_MESSAGE, SETTLEMENT_RECOVERY_MESSAGE, SETTLEMENT_STOP_MESSAGE,
  addSettlementDays, normalizePgSettlementFilters, pgSettlementAccountName, pgSettlementHref, pgSettlementPeriodProblem, settlementFailureLabel, settlementFailureLabels, settlementJobLabel, settlementUncertainMessage,
} from './console';

describe('settlement console filters', () => {
  const now = new Date('2026-10-31T15:01:00Z');
  it('defaults to this month in Korea and separates test from live statements', () => {
    expect(normalizePgSettlementFilters({}, now)).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01', mode: 'live', tab: 'daily', rangeError: null });
    expect(normalizePgSettlementFilters({ mode: 'test' }, now).mode).toBe('test');
  });
  it('does not silently replace an invalid or reversed period with a different statement', () => {
    for (const [from, to] of [['2026-10-31', '2026-10-01'], ['2026-10-01', '2026-11-01'], ['2026-02-30', '2026-03-01']]) {
      const parsed = normalizePgSettlementFilters({ from, to }, now);
      expect(parsed.startDate).toBe(from); expect(parsed.endDate).toBe(to); expect(parsed.rangeError).not.toBeNull();
    }
  });
  it('retains range and transaction filters while switching tabs or pages', () => {
    const filters = normalizePgSettlementFilters({ tab: 'transactions', mode: 'test', query: '주문 1', kind: 'cancel', match: 'mismatch', currency: 'KRW', pageSize: '50', import: 'aa7b8b20-6e2e-40c9-9d2d-dff9fb053c30' }, now);
    const href = pgSettlementHref(filters, { tab: 'fees', page: 2 });
    expect(normalizePgSettlementFilters(Object.fromEntries(new URL(href, 'http://localhost').searchParams), now)).toEqual({ ...filters, tab: 'fees', page: 2 });
  });
  it('bounds URL input and never renders raw error text', () => {
    const filters = normalizePgSettlementFilters({ page: '-1', pageSize: '20000', query: 'q'.repeat(101), currency: '<script>', import: 'private-key' }, now);
    expect(filters).toMatchObject({ page: 1, pageSize: 20, query: 'q'.repeat(100), currency: '', importId: null });
    expect(settlementFailureLabel('private-provider-error')).not.toContain('private-provider-error');
  });
});

it('정기결제 프로필 선택을 페이지·파일 URL에 보존하고 잘못된 계정은 실패한다', () => {
  const key = '287b949d-af67-4398-b0d2-09adbd123456';
  const filters = normalizePgSettlementFilters({ account: key, mode: 'test' });expect(filters.account).toBe(key);expect(filters.rangeError).toBeNull();
  expect(new URL(pgSettlementHref(filters, { page: 2 }), 'http://localhost').searchParams.get('account')).toBe(key);
  expect(normalizePgSettlementFilters({ account: 'billing:bad' }).rangeError).not.toBeNull();
});

describe('조회기간은 시작일부터 31일까지이고 어긋나면 고칠 방법을 말한다', () => {
  const now = new Date('2026-10-31T15:01:00Z');
  it('화면 입력이 쓰는 31일 한도는 서버가 받는 한도와 같다', () => {
    /* 시작일을 포함해 31일(차이 30일)까지 받고 하루 더 넘으면 받지 않는다 — 입력칸이 막는 날짜와 서버가 거절하는 날짜가 같아야 한다. */
    expect(normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31' }, now).rangeError).toBeNull();
    expect(normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-11-01' }, now).rangeError).not.toBeNull();
    expect(addSettlementDays('2026-10-01', PG_SETTLEMENT_MAX_SPAN_DAYS)).toBe('2026-10-31');
    expect(pgSettlementPeriodProblem('2026-10-01', '2026-10-31')).toBeNull();
    expect(pgSettlementPeriodProblem('2026-10-01', '2026-11-01')).toBe('종료일은 시작일부터 31일 안에서 골라 주세요.');
  });
  it('시작일이 종료일보다 늦은 경우와 31일을 넘은 경우, 날짜가 아닌 경우를 따로 말한다', () => {
    expect(normalizePgSettlementFilters({ from: '2026-10-31', to: '2026-10-01' }, now).rangeError).toBe('시작일이 종료일보다 늦습니다. 날짜를 바꿔 다시 검색해 주세요.');
    expect(normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-11-05' }, now).rangeError).toBe('조회기간은 시작일부터 최대 31일입니다. 종료일을 줄여 다시 검색해 주세요.');
    expect(normalizePgSettlementFilters({ from: '2026-02-30', to: '2026-03-01' }, now).rangeError).toBe('시작일과 종료일을 올바른 날짜로 입력해 주세요.');
    expect(pgSettlementPeriodProblem('2026-10-31', '2026-10-01')).toBe('종료일은 시작일과 같거나 그 뒤의 날짜로 골라 주세요.');
    /* 아직 날짜가 아닌 입력(비어 있음·입력 중)은 말하지 않는다 — 브라우저가 필수 칸으로 알린다. */
    expect(pgSettlementPeriodProblem('', '2026-10-01')).toBeNull(); expect(pgSettlementPeriodProblem('2026-10-01', '2026-1')).toBeNull();
  });
  it('날짜 더하기는 달·해 경계를 넘고 허용 범위를 벗어나거나 날짜가 아니면 빈 글자를 돌려준다', () => {
    expect(addSettlementDays('2026-12-15', 30)).toBe('2027-01-14'); expect(addSettlementDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addSettlementDays('2099-12-31', 1)).toBe(''); expect(addSettlementDays('2000-01-01', -1)).toBe(''); expect(addSettlementDays('', 1)).toBe('');
  });
});

describe('가져오기 안내는 화면에 적힌 버튼 이름 그대로 가리킨다', () => {
  const names = Object.values(SETTLEMENT_ACTIONS) as string[];
  const sentences = [SETTLEMENT_BUSY_MESSAGE, SETTLEMENT_PAUSED_MESSAGE, SETTLEMENT_STOP_MESSAGE, SETTLEMENT_QUERY_MISMATCH_MESSAGE, SETTLEMENT_RECOVERY_MESSAGE,
    settlementUncertainMessage(true), settlementUncertainMessage(false), ...Object.keys(settlementFailureLabels).map(code => settlementFailureLabels[code]), settlementFailureLabel('unknown_code')!];
  it('[이름]으로 적은 말은 모두 버튼 이름표에 있다', () => {
    for (const sentence of sentences) for (const [, name] of sentence.matchAll(/\[([^\]]+)\]/g)) expect(names, sentence).toContain(name);
  });
  it('운영자가 읽는 말에 개발 말(수집·PG·요청·응답)과 영문 코드가 없다', () => {
    for (const sentence of sentences) { expect(sentence).not.toMatch(/수집|\bPG\b|요청|응답|[a-z]+_[a-z_]+/); expect(sentence).toMatch(/[.]$/); }
    expect(names.every(name => !/수집/.test(name))).toBe(true);
  });
  it('결과를 모를 때는 같은 자료를 두 번 가져오지 않는다고 말한다', () => {
    expect(settlementUncertainMessage(false)).toBe('가져왔는지 확인하지 못했습니다. [가져왔는지 확인]을 누르면 같은 자료를 두 번 가져오지 않습니다.');
    expect(settlementUncertainMessage(true)).toContain('[현재 상태 확인]');
  });
  it('끝내지 못한 이유는 다음 행동을 함께 말한다(이어서·다시·기간 줄이기·개발 담당자)', () => {
    expect(settlementFailureLabel('provider_unavailable')).toContain('[이어서 가져오기]');
    for (const code of ['invalid_response', 'duplicate_transaction', 'snapshot_changed', 'scope_changed']) expect(settlementFailureLabel(code)).toContain('[다시 가져오기]');
    for (const code of ['response_too_large', 'page_limit']) expect(settlementFailureLabel(code)).toContain('조회기간을 줄여');
    for (const code of ['merchant_mismatch', 'provider_credentials']) expect(settlementFailureLabel(code)).toContain('개발 담당자');
    expect(settlementFailureLabel(null)).toBeNull();
  });
  it('가져오기 상태 이름은 이 화면이 가져오는 중일 때만 가져오는 중이다', () => {
    expect(settlementJobLabel({ state: 'collecting', scan: 1 }, true)).toBe('가져오는 중');
    expect(settlementJobLabel({ state: 'verifying', scan: 2 }, true)).toBe('확인하는 중');
    expect(settlementJobLabel({ state: 'collecting', scan: 1 })).toBe('중간에 멈춤');
    expect(settlementJobLabel({ state: 'complete', scan: 2 })).toBe('가져옴'); expect(settlementJobLabel({ state: 'failed', scan: 1 })).toBe('가져오기 중단');
  });
});

describe('정산 계정 이름에는 내부 번호를 쓰지 않는다', () => {
  const option = (accountId: string, integration: 'toss_payment' | 'toss_billing', mode: 'test' | 'live' = 'live') => ({ accountId, integration, mode, label: `x · 계정 ${accountId.slice(0, 8)}` });
  const a = option('aaaaaaaa-af67-4398-b0d2-09adbd123459', 'toss_payment'), b = option('bbbbbbbb-af67-4398-b0d2-09adbd123459', 'toss_billing'), c = option('cccccccc-af67-4398-b0d2-09adbd123459', 'toss_billing');
  it('같은 종류가 하나뿐이면 종류 이름만, 둘 이상이면 목록 순서로 번호를 붙인다', () => {
    expect(pgSettlementAccountName(a, [a, b])).toBe('일반 결제'); expect(pgSettlementAccountName(b, [a, b])).toBe('정기결제');
    expect(pgSettlementAccountName(b, [a, b, c])).toBe('정기결제 1'); expect(pgSettlementAccountName(c, [a, b, c])).toBe('정기결제 2');
  });
  it('환경이 다른 계정은 세지 않고, 목록에 없으면 종류 이름만 쓴다', () => {
    const test = option('dddddddd-af67-4398-b0d2-09adbd123459', 'toss_billing', 'test');
    expect(pgSettlementAccountName(b, [a, b, test])).toBe('정기결제'); expect(pgSettlementAccountName(c, [a, b])).toBe('정기결제'); expect(pgSettlementAccountName(a)).toBe('일반 결제');
    for (const name of [a, b, c, test].map(item => pgSettlementAccountName(item, [a, b, c, test]))) expect(name).not.toMatch(/[0-9a-f]{8}|계정/);
  });
});
