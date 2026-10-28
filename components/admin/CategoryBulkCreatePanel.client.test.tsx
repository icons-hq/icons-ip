import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ bulk: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/category-actions', () => ({ bulkCreateAdminCategoriesAction: mocks.bulk }));

import { CategoryBulkCreatePanel } from './CategoryBulkCreatePanel';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: unknown) => void; disabled?: boolean; value?: string; 'aria-label'?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return CategoryBulkCreatePanel(); }
function type(value: string) { all(render()).find(item => item.type === 'textarea')?.props.onChange?.({ target: { value } }); }
function submit() { const node = all(render()).find(item => item.type === 'button'); if (!node) throw new Error('button'); return node; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

const result = {
  createdCategories: 5, createdLines: 2, skippedLines: 1, failedLines: 1,
  lines: [
    { line: 1, path: '문구>노트>스프링노트', status: 'created', created: 3, reason: null },
    { line: 2, path: '문구>메모/수첩>메모지', status: 'created', created: 2, reason: null },
    { line: 4, path: '문구>노트>스프링노트', status: 'skipped', created: 0, reason: null },
    { line: 5, path: '가>나>다>라>마', status: 'failed', created: 0, reason: 'category_depth_exceeded' },
  ],
};

beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; });

it('붙여넣은 경로 줄 수를 세고, 비어 있으면 등록 버튼을 막는다', () => {
  expect(submit().props.disabled).toBe(true);
  type('문구>노트>스프링노트\n\n문구>메모/수첩>메모지');
  expect(text(render())).toContain('경로 2줄');
  expect(submit().props.disabled).toBe(false);
});

it('결과를 번호·결과·사유 표로 보이고 목록을 새로 고친다', async () => {
  mocks.bulk.mockResolvedValue({ ok: true, result });
  type('문구>노트>스프링노트\n문구>메모/수첩>메모지\n\n문구>노트>스프링노트\n가>나>다>라>마');
  submit().props.onClick?.();
  submit().props.onClick?.();
  await settle();
  expect(mocks.bulk).toHaveBeenCalledOnce();
  expect(mocks.bulk.mock.calls[0][0]).toMatchObject({ text: '문구>노트>스프링노트\n문구>메모/수첩>메모지\n\n문구>노트>스프링노트\n가>나>다>라>마' });
  const tree = render();
  const headers = all(tree).filter(item => item.type === 'th' && (item.props as { scope?: string }).scope === 'col').map(text);
  expect(headers).toEqual(['번호', '결과', '사유']);
  const rows = all(tree).filter(item => item.type === 'tr').slice(1).map(row => all(row.props.children).filter(cell => cell.type === 'th' || cell.type === 'td').map(text));
  expect(rows).toEqual([
    ['1 · 문구>노트>스프링노트', '처리됨', '새 카테고리 3개를 만들었습니다.'],
    ['2 · 문구>메모/수첩>메모지', '처리됨', '새 카테고리 2개를 만들었습니다.'],
    ['4 · 문구>노트>스프링노트', '건너뜀', '이미 등록된 경로입니다.'],
    ['5 · 가>나>다>라>마', '실패', '카테고리는 최대 4단계까지만 만들 수 있습니다.'],
  ]);
  expect(text(tree)).toContain('경로 4줄 중 처리 2 · 건너뜀 1 · 실패 1 · 새 카테고리 5개');
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('응답을 받지 못하면 같은 작업 번호로 다시 보내 중복 생성을 막는다', async () => {
  mocks.bulk.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, result });
  type('문구>노트>스프링노트');
  submit().props.onClick?.();
  await settle();
  expect(text(render())).toContain('결과를 확인하지 못했습니다');
  submit().props.onClick?.();
  await settle();
  expect(mocks.bulk).toHaveBeenCalledTimes(2);
  expect(mocks.bulk.mock.calls[1][0].operationId).toBe(mocks.bulk.mock.calls[0][0].operationId);
  /* 확정된 응답 뒤 새 요청은 새 작업 번호를 쓴다. */
  type('문구>노트>스프링노트\n리빙>수납');
  mocks.bulk.mockResolvedValueOnce({ ok: false, error: '관리자 권한이 필요합니다.' });
  submit().props.onClick?.();
  await settle();
  expect(mocks.bulk.mock.calls[2][0].operationId).not.toBe(mocks.bulk.mock.calls[0][0].operationId);
  expect(text(render())).toContain('관리자 권한이 필요합니다.');
});
