import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * R8 일괄 처리 화면 쪽 규칙: 지금 페이지에서 처리할 수 있는 선택만 보내고, 누른 작업의 확인을
 * 거친 뒤에만 보낸다. 시간 예산으로 남은 건은 선택에 남아 그대로 다시 실행할 수 있다.
 */

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, action: null as null | ((previous: unknown, form: FormData) => Promise<unknown>), actionState: {} as unknown }));
const mocks = vi.hoisted(() => ({ run: vi.fn(), bulk: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    startTransition: (callback: () => void) => callback(),
    useId: () => 'reason',
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
vi.mock('@/app/admin/claim-actions', () => ({ bulkDecideOrderClaimsAction: mocks.bulk }));

import { ClaimBulkResultTable, ClaimQueueBulkGrid } from './ClaimQueueBulk';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}

function render() {
  hooks.index = 0;
  return ClaimQueueBulkGrid({
    caption: '취소 요청 목록',
    claimType: 'cancel',
    columns: [{ key: 'reference', label: '요청번호' }],
    emptyLabel: '없음',
    preferencesKey: 'sales-claims-cancel',
    previewHrefBase: '/admin/sales/claims/cancels?stage=open&page=1',
    rows: [
      { id: A, cells: ['C00001'] },
      { id: B, cells: ['C00002'] },
      { id: C, cells: ['C00003'], selectable: false },
    ],
  });
}

function select(ids: string[]) {
  const grid = all(render()).find((element) => element.props.caption === '취소 요청 목록');
  (grid?.props.onSelectionChange as (ids: string[]) => void)(ids);
}

function submit(decision: string, note = '') {
  select([A, B, C]);
  const reason = all(render()).find((element) => element.props.name === 'note');
  (reason?.props.onChange as (event: unknown) => void)({ target: { value: note } });
  const form = all(render()).find((element) => element.type === 'form');
  const formElement = {
    getAttribute: () => null,
  };
  const submitter = { getAttribute: (name: string) => (name === 'name' ? 'decision' : decision) };
  const captured: FormData[] = [];
  const hidden = all(render()).filter((node) => node.type === 'input' && node.props.type === 'hidden');
  const Original = globalThis.FormData;
  globalThis.FormData = class extends Original {
    constructor() {
      super();
      for (const element of hidden) this.append(String(element.props.name), String(element.props.value));
      this.set('decision', decision);
      this.set('note', note);
      captured.push(this);
    }
  } as typeof FormData;
  try {
    (form?.props.onSubmit as (event: unknown) => void)({
      preventDefault: () => {},
      currentTarget: formElement,
      nativeEvent: { submitter },
    });
  } finally {
    globalThis.FormData = Original;
  }
  return captured;
}

beforeEach(() => {
  hooks.state = [];
  hooks.actionState = {};
  vi.clearAllMocks();
  vi.stubGlobal('window', { confirm: mocks.confirm });
});

it('처리할 수 없는 행은 선택해도 보내지 않고, 확인한 뒤에만 지금 페이지의 선택을 보낸다', () => {
  mocks.confirm.mockReturnValue(true);
  const sent = submit('approve');
  expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('선택한 2건의 취소를 승인할까요?'));
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(sent[0].getAll('claimIds')).toEqual([A, B]);
  expect(sent[0].get('claimType')).toBe('cancel');
});

it('확인을 취소하거나 거부 사유가 짧으면 보내지 않는다', () => {
  mocks.confirm.mockReturnValue(false);
  submit('approve');
  expect(mocks.run).not.toHaveBeenCalled();

  mocks.confirm.mockReturnValue(true);
  submit('reject', '짧은 사유');
  expect(mocks.run).not.toHaveBeenCalled();
  const alert = all(render()).find((element) => element.props.role === 'alert');
  expect(alert?.props.children).toBe('거부 사유를 10자 이상 200자 이하로 입력해주세요.');
});

it('시간 예산으로 남은 건만 선택에 남긴다', async () => {
  select([A, B]);
  mocks.bulk.mockResolvedValue({
    summary: '처리됨 1건 · 실패 0건 · 처리 시간이 길어 1건은 처리하지 않았습니다. 다시 실행하세요.',
    results: [
      { claimId: A, reference: 'C00001', outcome: 'done', message: '검토중으로 표시했습니다.' },
      { claimId: B, reference: 'C00002', outcome: 'skipped', message: '처리 시간이 길어 처리하지 않았습니다. 다시 실행하세요.' },
    ],
  });
  await hooks.action?.({}, new FormData());
  const hidden = all(render()).filter((element) => element.props.name === 'claimIds').map((element) => element.props.value);
  expect(hidden).toEqual([B]);
});

it('결과표는 번호·결과·사유 세 열이고 요청번호가 같은 목록 위 팝업을 연다', () => {
  const html = renderToStaticMarkup(<ClaimBulkResultTable previewHrefBase="/admin/sales/claims/returns?stage=open&page=1" state={{
    summary: '처리됨 1건 · 실패 1건',
    results: [
      { claimId: A, reference: 'C00001', outcome: 'done', message: '클레임을 승인하고 수거를 시작했습니다.' },
      { claimId: B, reference: null, outcome: 'failed', message: '클레임을 찾을 수 없습니다.' },
    ],
  }} />);
  expect(html.match(/<table/g)).toHaveLength(1);
  expect(html).toContain('<th scope="col">번호</th><th scope="col">결과</th><th scope="col">사유</th>');
  expect(html).toContain('처리됨');
  expect(html).toContain('실패');
  expect(html).toContain(`href="/admin/sales/claims/returns?stage=open&amp;page=1&amp;claimId=${A}"`);
  expect(html).toContain('확인 불가');
});
