import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  pending: [] as Promise<unknown>[],
  refresh: vi.fn(),
  preview: vi.fn(),
  commit: vi.fn(),
  workspace: null as null | { registerCompare: (handler: ((codes: readonly string[]) => void) | null) => void },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hooks.refresh }),
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error; },
}));
vi.mock('@/app/admin/erp-item-actions', () => ({ previewErpLinkedGoodsAction: hooks.preview, commitErpLinkedGoodsAction: hooks.commit }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useContext: () => hooks.workspace,
    useEffect: (effect: () => unknown) => { if (hooks.workspace) effect(); },
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

const { ErpLinkedGoodsPanel } = await import('./ErpLinkedGoodsPanel');
const { Button } = await import('./kit/ui/button');

type Props = { children?: ReactNode; type?: string; checked?: boolean; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { checked: boolean } }) => void; 'aria-label'?: string; title?: ReactNode; caption?: string };

function render() {
  hooks.stateIndex = 0;
  return ErpLinkedGoodsPanel();
}
function find(tree: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(tree)) return Array.isArray(tree) ? tree.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(tree) ? [tree] : [];
  for (const child of [tree.props.children].flat()) matches.push(...find(child, predicate));
  return matches;
}
function text(tree: ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (!isValidElement<Props>(tree)) return '';
  /* 행 상태 칸은 작은 부품이라 그 자리에서 그려 글자를 읽는다. */
  if (typeof tree.type === 'function' && (tree.type as { name?: string }).name === 'RowState') return text((tree.type as (props: unknown) => ReactNode)(tree.props));
  return text(tree.props.children);
}
const button = (tree: ReactNode, label: string) => find(tree, (element) => (element.type === 'button' || element.type === Button) && text(element).includes(label))[0];
const checkbox = (tree: ReactNode, label: string) => find(tree, (element) => element.type === 'input' && element.props['aria-label'] === label)[0];
async function settle() { await Promise.all(hooks.pending.splice(0)); }

const A = '00000000-0000-4000-8000-000000071201';
const B = '00000000-0000-4000-8000-000000071202';
const row = (variantId: string, field: 'price' | 'barcode', extra: Record<string, unknown> = {}) => ({
  key: `${variantId}:${field}`, field, goodId: variantId === A ? 'good-a' : 'good-b', goodName: variantId === A ? '아크릴 키링' : '포토카드', goodCode: 'G',
  published: true, variantId, optionName: '기본 옵션', isDefault: true, erpCode: variantId === A ? '000123' : '000456', erpName: '품목',
  current: field === 'price' ? 10000 : null, next: field === 'price' ? 11000 : '0088012345678', status: 'apply', reason: null, warning: null, ...extra,
});
const preview = (rows: ReturnType<typeof row>[], extra: Record<string, unknown> = {}) => ({
  ok: true, preview: { operationId: 'op-1', expiresAt: '2026-11-13T01:15:00Z', scopeCount: null, linked: 5, total: rows.length, truncated: false, rows, ...extra },
});
const ROWS = [
  row(A, 'price'),
  row(A, 'barcode', { current: '0088000000000', warning: 'barcode_changed' }),
  row(B, 'price', { current: 15000, next: 16000, status: 'skip', reason: 'active_discount' }),
];

beforeEach(() => {
  hooks.state = [];
  hooks.pending = [];
  hooks.refresh.mockReset();
  hooks.preview.mockReset().mockResolvedValue(preview(ROWS));
  hooks.commit.mockReset();
  hooks.workspace = null;
  vi.unstubAllGlobals();
});

describe('연결 상품 반영 패널', () => {
  it('전체 품목과 비교하면 값이 다른 행만 보이고, 반영할 수 있는 행은 미리 고르며 건너뛰는 행은 이유를 보인다', async () => {
    expect(text(render())).toContain('할인 중인 상품(기간 할인 진행·예정, 즉시할인)은 건너뜁니다.');
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    expect(hooks.preview).toHaveBeenCalledWith(null);
    const tree = render();
    expect(text(tree)).toContain('반입한 전체 ERP 품목과 비교했습니다. 연결 옵션 5개 중 값이 다른 행 3건 · 반영할 수 있는 판매가 1건·바코드 1건 · 건너뜀 1건.');
    expect(checkbox(tree, '아크릴 키링 기본 옵션 판매가 반영').props.checked).toBe(true);
    expect(checkbox(tree, '아크릴 키링 기본 옵션 바코드 반영').props.checked).toBe(true);
    expect(checkbox(tree, '포토카드 기본 옵션 판매가 반영')).toBeUndefined();
    expect(text(tree)).toContain('건너뜀 · 기간 할인 중');
    expect(text(tree)).toContain('할인을 중지한 뒤 다시 비교해주세요.');
    expect(text(tree)).toContain('바코드 바뀜');
    expect(find(tree, (element) => element.props.title === '바코드가 바뀌는 행 1건')).toHaveLength(1);
    expect(text(tree)).toContain('10,000원');
    expect(text(tree)).toContain('11,000원');
    expect(text(button(tree, '건 반영'))).toBe('선택한 2건 반영');
  });

  it('반입을 마치면 등록된 비교가 방금 반입한 ERP 코드로 미리보기를 연다', async () => {
    const handlers: ((codes: readonly string[]) => void)[] = [];
    hooks.workspace = { registerCompare: (handler) => { if (handler) handlers.push(handler); } };
    hooks.preview.mockResolvedValueOnce(preview([row(A, 'price')], { scopeCount: 2 }));
    render();
    handlers.at(-1)?.(['000123', '000456']);
    await settle();
    expect(hooks.preview).toHaveBeenCalledWith(['000123', '000456']);
    expect(text(render())).toContain('방금 반입한 품목 2개와 비교했습니다.');
  });

  it('고른 행만 확인한 뒤 반영하고, 막힌 행은 사유와 함께 남긴다', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });
    hooks.commit.mockResolvedValueOnce({ ok: true, receipt: { state: 'completed', operationId: 'op-1', applied: { price: 1, barcode: 0, goods: 1 },
      failed: [] }, message: '상품 1개에 판매가 1건을 반영했습니다.' });
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    checkbox(render(), '아크릴 키링 기본 옵션 바코드 반영').props.onChange?.({ target: { checked: false } });
    button(render(), '선택한 1건 반영').props.onClick?.();
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('연결 상품 1개에 판매가 1건을 반영할까요?'));
    expect(hooks.commit).toHaveBeenCalledWith({ operationId: 'op-1', keys: [`${A}:price`] });
    const tree = render();
    expect(text(tree)).toContain('상품 1개에 판매가 1건을 반영했습니다.');
    expect(text(tree)).not.toContain('값이 다른 행');
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('확인창에서 취소하면 보내지 않고, 상품 저장 규칙에 막힌 행은 사유 표로 보인다', async () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    button(render(), '선택한 2건 반영').props.onClick?.();
    expect(hooks.commit).not.toHaveBeenCalled();
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    hooks.commit.mockResolvedValueOnce({ ok: true, receipt: { state: 'completed', operationId: 'op-1', applied: { price: 0, barcode: 1, goods: 1 },
      failed: [{ key: `${A}:price`, field: 'price', goodId: 'good-a', goodName: '아크릴 키링', optionName: '기본 옵션', error: 'goods_notice_required' }] },
      message: '상품 1개에 바코드 1건을 반영했습니다. 1건은 상품 저장 규칙에 막혀 반영하지 못했습니다. 아래 사유를 확인해주세요.' });
    button(render(), '선택한 2건 반영').props.onClick?.();
    await settle();
    const tree = render();
    expect(text(tree)).toContain('1건은 상품 저장 규칙에 막혀 반영하지 못했습니다.');
    expect(text(tree)).toContain('상품정보제공고시가 빈 공개 상품이라 저장할 수 없습니다.');
  });

  it('요청 오류는 미리보기를 남겨 고쳐서 다시 반영하게 하고, 거절 결과는 다시 비교하라고 한다', async () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    hooks.commit.mockResolvedValueOnce({ ok: false, error: '다른 작업이 같은 상품을 저장하고 있습니다. 잠시 뒤 다시 반영해주세요.' });
    button(render(), '선택한 2건 반영').props.onClick?.();
    await settle();
    let tree = render();
    expect(text(tree)).toContain('다른 작업이 같은 상품을 저장하고 있습니다.');
    expect(button(tree, '선택한 2건 반영')).toBeDefined();
    hooks.commit.mockRejectedValueOnce(new Error('socket'));
    button(tree, '선택한 2건 반영').props.onClick?.();
    await settle();
    tree = render();
    expect(text(tree)).toContain('같은 미리보기에서 다시 반영하면 이미 반영한 행은 다시 바꾸지 않습니다.');
    hooks.commit.mockResolvedValueOnce({ ok: true, receipt: { state: 'rejected', operationId: 'op-1', error: 'erp_goods_apply_changed' },
      message: '미리보기 뒤 상품이나 ERP 값이 바뀌어 아무것도 반영하지 않았습니다. 다시 비교해주세요.' });
    button(tree, '선택한 2건 반영').props.onClick?.();
    await settle();
    tree = render();
    expect(text(tree)).toContain('아무것도 반영하지 않았습니다. 다시 비교해주세요.');
    expect(button(tree, '건 반영')).toBeUndefined();
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  it('연결 옵션이 없거나 값이 모두 같으면 그렇게 알리고 반영 버튼을 두지 않는다', async () => {
    hooks.preview.mockResolvedValueOnce(preview([], { linked: 0 }));
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    expect(text(render())).toContain('같은 ERP 코드를 넣은 상품 옵션이 없습니다.');
    hooks.preview.mockResolvedValueOnce(preview([], { linked: 3 }));
    button(render(), '전체 품목과 비교').props.onClick?.();
    await settle();
    const tree = render();
    expect(text(tree)).toContain('연결 옵션 3개의 판매가·바코드가 반입한 값과 모두 같습니다.');
    expect(button(tree, '건 반영')).toBeUndefined();
  });
});
