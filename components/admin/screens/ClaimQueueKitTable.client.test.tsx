import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * R8 일괄 처리 화면 쪽 규칙(취소·반품·교환 kit 목록 공통): 지금 페이지에서 처리할 수 있는 선택만 보내고,
 * 누른 작업의 확인을 거친 뒤에만 보낸다. 시간 예산으로 남은 건은 선택에 남아 그대로 다시 실행할 수 있다.
 * 표 자체(TanStack)는 useConsoleTable 대역으로 바꾸고, 표에 넘기는 선택 상태로 무엇이 선택됐는지 본다.
 */

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  index: 0,
  action: null as null | ((previous: unknown, form: FormData) => Promise<unknown>),
  actionState: {} as unknown,
  table: null as null | Record<string, unknown>,
}));
const mocks = vi.hoisted(() => ({ run: vi.fn(), bulk: vi.fn(), confirm: vi.fn(), push: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    startTransition: (callback: () => void) => callback(),
    useMemo: (factory: () => unknown) => factory(),
    useTransition: () => [false, (callback: () => void) => callback()],
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.state)) hooks.state[index] = initial;
      return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }];
    },
    useActionState: (action: (previous: unknown, form: FormData) => Promise<unknown>) => {
      hooks.action = action;
      return [hooks.actionState, mocks.run, false];
    },
  };
});
/* 로그인 만료 같은 Next 리디렉션은 진짜 unstable_rethrow로 다시 던져야 한다. 이동만 대역으로 바꾼다. */
vi.mock('next/navigation', async () => ({ ...await vi.importActual<typeof import('next/navigation')>('next/navigation'), useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/app/admin/claim-actions', () => ({ bulkDecideOrderClaimsAction: mocks.bulk }));
vi.mock('@/components/admin/kit/use-console-table', () => ({
  useConsoleTable: (options: Record<string, unknown>) => {
    hooks.table = options;
    return { pending: false, preferences: { order: [], hidden: [], frozen: 0 }, savePreferences: () => undefined, table: {} };
  },
}));

import { ActionBarItem } from '@/components/admin/kit/ui/action-bar';
import { Button } from '@/components/admin/kit/ui/button';
import { ADMIN_CLAIM_BULK_ACTION_LABELS } from '@/lib/admin/claim-bulk';
import { ADMIN_CLAIM_DATE_FIELDS, ADMIN_CLAIM_SEARCH_FIELDS, type AdminClaimFilters } from '@/lib/admin/claims';
import { ClaimKitBulkResult, ClaimQueueKitTable, type ClaimKitRow } from './ClaimQueueKitTable';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILTERS: AdminClaimFilters = { from: null, page: 1, query: '', reasonType: 'all', stage: 'open', to: null };

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}
function text(node: ReactNode): string {
  return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node as Element).props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function row(id: string, reference: string, selectable = true): ClaimKitRow {
  return {
    id, selectable, reference, previewHref: `/admin/sales/claims/cancels?stage=open&page=1&claimId=${id}`, order: '20261101-0000001', type: '취소',
    reason: '단순 변심', stage: '취소요청', buyer: 'buyer', amount: 1000, amountLabel: '₩1,000', requestedAt: '2026-11-01T00:00:00.000Z',
    requestedLabel: '2026. 11. 1. 09:00', slaLabel: '-', slaTone: 'neutral', refund: null, handler: null,
  };
}

function render() {
  hooks.index = 0;
  return ClaimQueueKitTable({
    claimType: 'cancel',
    dateFieldOptions: ADMIN_CLAIM_DATE_FIELDS,
    filters: FILTERS,
    pageSize: 20,
    rows: [row(A, 'C00001'), row(B, 'C00002'), row(C, 'C00003', false)],
    searchFieldOptions: ADMIN_CLAIM_SEARCH_FIELDS,
    total: 3,
  });
}

/** 표에서 고른 행. 표가 넘겨받은 선택 상태로 확인한다. */
function select(ids: string[]) {
  render();
  (hooks.table!.onRowSelectionChange as (value: unknown) => void)(Object.fromEntries(ids.map((id) => [id, true])));
}
function selected() {
  render();
  const selection = hooks.table!.rowSelection as Record<string, boolean>;
  return Object.keys(selection).filter((id) => selection[id]);
}

/** 처리 막대의 버튼을 누른다. 거부는 팝오버의 사유 칸을 채운 뒤 팝오버 안 실행 버튼을 누른다. */
function act(decision: 'approve' | 'review' | 'reject', note = '') {
  select([A, B, C]);
  if (decision === 'reject') {
    const reason = all(render()).find((element) => element.props.claimType === 'cancel' && typeof element.props.onChange === 'function');
    (reason?.props.onChange as (value: string) => void)(note);
    const run = all(render()).find((element) => element.type === Button && text(element).endsWith('건 거부'));
    (run?.props.onClick as () => void)();
    return;
  }
  const item = all(render()).find((element) => element.type === ActionBarItem && element.props.children === ADMIN_CLAIM_BULK_ACTION_LABELS[decision]);
  (item?.props.onSelect as (event: unknown) => void)({ preventDefault: () => undefined });
}

beforeEach(() => {
  hooks.state = [];
  hooks.actionState = {};
  hooks.table = null;
  vi.clearAllMocks();
  vi.stubGlobal('window', { confirm: mocks.confirm });
});

it('처리할 수 없는 행은 선택해도 보내지 않고, 확인한 뒤에만 지금 페이지의 선택을 보낸다', () => {
  mocks.confirm.mockReturnValue(true);
  act('approve');
  expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('선택한 2건의 취소를 승인할까요?'));
  expect(mocks.run).toHaveBeenCalledTimes(1);
  const sent = mocks.run.mock.calls[0][0] as FormData;
  expect(sent.getAll('claimIds')).toEqual([A, B]);
  expect(sent.get('claimType')).toBe('cancel');
  expect(sent.get('decision')).toBe('approve');
});

it('검토중 표시도 확인 문구를 거쳐 같은 선택을 보낸다', () => {
  mocks.confirm.mockReturnValue(true);
  act('review');
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect((mocks.run.mock.calls[0][0] as FormData).get('decision')).toBe('review');
  expect((mocks.run.mock.calls[0][0] as FormData).getAll('claimIds')).toEqual([A, B]);
});

it('확인을 취소하거나 거부 사유가 짧으면 보내지 않는다', () => {
  mocks.confirm.mockReturnValue(false);
  act('approve');
  expect(mocks.run).not.toHaveBeenCalled();

  mocks.confirm.mockReturnValue(true);
  act('reject', '짧은 사유');
  expect(mocks.run).not.toHaveBeenCalled();
  const alert = all(render()).find((element) => element.props.role === 'alert');
  expect(text(alert)).toBe('거부 사유를 10자 이상 200자 이하로 입력해주세요.');
});

it('거부 사유를 채우면 선택한 모든 건에 같은 사유를 실어 보낸다', () => {
  mocks.confirm.mockReturnValue(true);
  act('reject', '반품 가능 기간이 지났습니다.');
  expect(mocks.run).toHaveBeenCalledTimes(1);
  const sent = mocks.run.mock.calls[0][0] as FormData;
  expect(sent.get('decision')).toBe('reject');
  expect(sent.get('note')).toBe('반품 가능 기간이 지났습니다.');
  expect(sent.getAll('claimIds')).toEqual([A, B]);
});

it('시간 예산으로 남은 건만 선택에 남기고, 다시 실행하면 그 건만 보낸다', async () => {
  select([A, B]);
  mocks.bulk.mockResolvedValue({
    summary: '처리됨 1건 · 실패 0건 · 처리 시간이 길어 1건은 처리하지 않았습니다. 다시 실행하세요.',
    results: [
      { claimId: A, reference: 'C00001', outcome: 'done', message: '검토중으로 표시했습니다.' },
      { claimId: B, reference: 'C00002', outcome: 'skipped', message: '처리 시간이 길어 처리하지 않았습니다. 다시 실행하세요.' },
    ],
  });
  await hooks.action?.({}, new FormData());
  expect(selected()).toEqual([B]);

  mocks.confirm.mockReturnValue(true);
  const item = all(render()).find((element) => element.type === ActionBarItem && element.props.children === ADMIN_CLAIM_BULK_ACTION_LABELS.approve);
  (item?.props.onSelect as (event: unknown) => void)({ preventDefault: () => undefined });
  expect((mocks.run.mock.calls[0][0] as FormData).getAll('claimIds')).toEqual([B]);
});

it('서버 액션이 실패해도(함수 시간 초과 등) 오류 경계로 올리지 않고 새로고침 안내를 돌려준다', async () => {
  select([A, B]);
  mocks.bulk.mockRejectedValue(new Error('FUNCTION_INVOCATION_TIMEOUT'));
  await expect(hooks.action?.({}, new FormData())).resolves.toEqual({
    error: '처리 결과를 받지 못했습니다. 목록을 새로고침해 각 건의 상태를 확인하세요.',
  });
  /* 어떤 건이 처리됐는지 모르므로 선택은 그대로 둔다(같은 건을 다시 실행해도 단건 경로가 멱등이다). */
  expect(selected()).toEqual([A, B]);
});

it('로그인 만료 같은 Next 리디렉션은 삼키지 않는다', async () => {
  const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
  mocks.bulk.mockRejectedValue(redirect);
  render();
  await expect(hooks.action?.({}, new FormData())).rejects.toBe(redirect);
});

it('결과표는 번호·결과·사유 세 열이고 요청번호가 같은 목록 위 팝업을 연다', () => {
  const html = renderToStaticMarkup(<ClaimKitBulkResult previewHrefBase="/admin/sales/claims/returns?stage=open&page=1" state={{
    summary: '처리됨 1건 · 실패 1건',
    results: [
      { claimId: A, reference: 'C00001', outcome: 'done', message: '클레임을 승인하고 수거를 시작했습니다.' },
      { claimId: B, reference: null, outcome: 'failed', message: '클레임을 찾을 수 없습니다.' },
    ],
  }} />);
  expect(html.match(/<table/g)).toHaveLength(1);
  expect([...html.matchAll(/<th[^>]*\bscope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])).toEqual(['번호', '결과', '사유']);
  expect(html).toContain('처리됨');
  expect(html).toContain('실패');
  expect(html).toContain(`href="/admin/sales/claims/returns?stage=open&amp;page=1&amp;claimId=${A}"`);
  expect(html).toContain('확인 불가');
  /* 운영 어휘: 결과 사유의 '클레임'은 운영 화면의 요청 어휘로 바뀐다. */
  expect(html).not.toContain('클레임을 승인');
});
