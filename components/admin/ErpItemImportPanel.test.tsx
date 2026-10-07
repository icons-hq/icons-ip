import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpImportIssue } from '@/lib/admin/erp-item-import';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  pending: [] as Promise<unknown>[],
  refresh: vi.fn(),
  importRows: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ importErpItemsAction: hooks.importRows, readErpItemFileAction: hooks.readFile }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
    useTransition: () => [false, (callback: () => Promise<unknown>) => { hooks.pending.push(callback()); }],
  };
});

const { ErpItemImportPanel } = await import('./ErpItemImportPanel');

type Props = {
  children?: ReactNode;
  id?: string;
  type?: string;
  value?: unknown;
  disabled?: boolean;
  issues?: ErpImportIssue[];
  caption?: string;
  onClick?: () => void;
  onChange?: (event: unknown) => void;
  'aria-label'?: string;
};

function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return ErpItemImportPanel();
}

function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(node) ? [node] : [];
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) matches.push(...find(child, predicate));
  return matches;
}

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}

const button = (tree: ReactNode, label: string) => find(tree, (element) => element.type === 'button' && text(element).includes(label))[0];
const select = (tree: ReactNode, label: string) => find(tree, (element) => element.type === 'select' && element.props['aria-label'] === label)[0];
async function settle() {
  await Promise.all(hooks.pending.splice(0));
}

const PASTED = [
  '품번\t품명\t카테고리\t판매가\t바코드',
  '000123\t아크릴 키링\t문구 > 키링\t12,000\t0088012345678',
  ...Array.from({ length: 600 }, (_, index) => `C${String(index).padStart(4, '0')}\t품목 ${index}\t문구\t1,000\t`),
  '\t빈 코드\t\t\t',
].join('\n');

beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.pending = [];
  hooks.refresh.mockReset();
  hooks.importRows.mockReset().mockImplementation(async (rows: unknown[]) => ({ ok: true, inserted: rows.length, updated: 0, unchanged: 0, rejected: [] }));
  hooks.readFile.mockReset();
});

describe('ERP 품목 반입 패널', () => {
  it('붙여넣은 표를 미리보기로 바꾸고, 500행씩 나눠 반입한 결과를 합친다', async () => {
    find(render(), (element) => element.props.id === 'erp-item-paste')[0].props.onChange?.({ target: { value: PASTED } });
    button(render(), '붙여넣은 표 확인').props.onClick?.();

    let tree = render();
    expect(text(tree)).toContain('반입 가능 601건');
    expect(select(tree, '품번 열의 항목').props.value).toBe('code');
    expect(select(tree, '바코드 열의 항목').props.value).toBe('barcode');
    const issues = find(tree, (element) => element.props.caption === '반입할 수 없는 행')[0];
    expect(issues.props.issues).toEqual([{ row: 603, code: '', reason: 'missing_code' }]);

    button(tree, '601건 반입').props.onClick?.();
    await settle();
    expect(hooks.importRows).toHaveBeenCalledTimes(2);
    expect(hooks.importRows.mock.calls[0][0]).toHaveLength(500);
    expect(hooks.importRows.mock.calls[0][0][0]).toEqual({ row: 2, code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0088012345678' });
    expect(hooks.importRows.mock.calls[1][0]).toHaveLength(101);
    tree = render();
    expect(text(tree)).toContain('추가 601');
    expect(text(tree)).toContain('거부 0');
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('열을 직접 바꾸면 그 열 기준으로 다시 미리보기하고, 필수 열이 없으면 반입을 막는다', () => {
    find(render(), (element) => element.props.id === 'erp-item-paste')[0].props.onChange?.({ target: { value: PASTED } });
    button(render(), '붙여넣은 표 확인').props.onClick?.();
    select(render(), '품번 열의 항목').props.onChange?.({ target: { value: 'ignore' } });
    const tree = render();
    expect(text(tree)).toContain('ERP 코드(품번) 열을 골라야 반입할 수 있습니다.');
    expect(button(tree, '0건 반입').props.disabled).toBe(true);
  });

  it('중간 묶음이 실패하면 반영된 건수와 다시 반입 안내를 함께 보여 준다', async () => {
    hooks.importRows
      .mockResolvedValueOnce({ ok: true, inserted: 499, updated: 0, unchanged: 0, rejected: [{ row: 9, code: 'C0007', reason: 'duplicate_code' }] })
      .mockResolvedValueOnce({ ok: false, error: 'ERP 품목을 반입하지 못했습니다. 같은 내용으로 다시 반입하면 이어서 반영됩니다.' });
    find(render(), (element) => element.props.id === 'erp-item-paste')[0].props.onChange?.({ target: { value: PASTED } });
    button(render(), '붙여넣은 표 확인').props.onClick?.();
    button(render(), '601건 반입').props.onClick?.();
    await settle();
    const tree = render();
    expect(text(tree)).toContain('500건까지 반입했습니다. ERP 품목을 반입하지 못했습니다. 같은 내용으로 다시 반입하면 이어서 반영됩니다.');
    expect(text(tree)).toContain('추가 499');
    expect(find(tree, (element) => element.props.caption === '반입하지 못한 행')[0].props.issues).toEqual([{ row: 9, code: 'C0007', reason: 'duplicate_code' }]);
  });

  it('파일은 서버에서 읽은 표와 경고를 미리보기에 넘기고, 읽기 오류는 그대로 안내한다', async () => {
    hooks.readFile
      .mockResolvedValueOnce({ ok: false, error: 'XLSX 또는 CSV 파일을 올려주세요.' })
      .mockResolvedValueOnce({ ok: true, fileName: '품목.xlsx', sheetName: '품목', numericColumns: [0], warnings: ['수식 셀 1개(E5)는 값을 읽지 않았습니다.'], table: [['품목코드', '품목명'], ['123', '키링']] });
    const fileInput = () => find(render(), (element) => element.props.type === 'file')[0];
    fileInput().props.onChange?.({ target: { files: [new File(['x'], 'a.pdf')] } });
    await settle();
    expect(text(render())).toContain('XLSX 또는 CSV 파일을 올려주세요.');
    fileInput().props.onChange?.({ target: { files: [new File(['x'], '품목.xlsx')] } });
    await settle();
    const tree = render();
    expect(hooks.readFile.mock.calls[1][0].get('file')).toBeInstanceOf(File);
    expect(text(tree)).toContain('미리보기 · 품목.xlsx · 품목 시트');
    expect(text(tree)).toContain('수식 셀 1개(E5)는 값을 읽지 않았습니다.');
    expect(text(tree)).toContain('ERP 코드(품번) 열에 숫자 형식 셀이 있습니다');
    expect(text(tree)).not.toContain('XLSX 또는 CSV 파일을 올려주세요.');
  });
});
