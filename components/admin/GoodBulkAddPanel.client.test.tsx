import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useId: () => 'bulk',
}));
vi.mock('@/app/admin/good-reference-actions', () => ({ resolveGoodReferencesAction: mocks.resolve, readGoodReferenceFileAction: mocks.read }));

import { GoodBulkAddPanel, type GoodBulkAddOptions } from './GoodBulkAddPanel';
import { Button } from './kit/ui/button';
import { Textarea } from './kit/ui/textarea';
import type { GoodReferenceMatch } from '@/lib/admin/good-references';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const match = (ref: string, extra: Partial<GoodReferenceMatch> = {}): GoodReferenceMatch => ({
  ref, status: 'found', matchedBy: 'code', id: ref.toLowerCase(), name: `QA 상품 ${ref}`, code: ref, archived: false, published: true, candidate: null, ...extra,
});

let options: GoodBulkAddOptions<string>;
function render() { hooks.index = 0; hooks.refIndex = 0; return nodes(GoodBulkAddPanel({ options })); }
function rows() { return render().filter(node => node.type === 'li' && node.props['data-good-bulk-row']); }
async function paste(value: string) {
  (render().find(node => node.type === Textarea)!.props.onChange as (event: unknown) => void)({ target: { value } });
  (render().find(node => node.type === Button && text(node.props.children as ReactNode) === '상품 확인')!.props.onClick as () => void)();
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function addAll() { (render().find(node => node.type === Button && /^추가 가능한 \d+개 담기$/.test(text(node.props.children as ReactNode)))!.props.onClick as () => void)(); }

beforeEach(() => {
  hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; vi.clearAllMocks();
  options = { capacity: 10, classify: found => ({ ok: true, id: found.id, item: found.id }), onAdd: vi.fn(), appliedHint: '선택 완료를 눌러 반영해주세요.' };
});

describe('여러 상품 한 번에 추가 — 비공개 상품(QA1 MD major)', () => {
  it('공개 전 상품도 추가 가능으로 담되, 그 줄과 합계에 비공개와 이유를 함께 보인다', async () => {
    mocks.resolve.mockResolvedValueOnce({ ok: true, matches: [match('QA-PR1'), match('QA-PR9', { published: false })] });
    await paste('QA-PR1\nQA-PR9');
    const [publicRow, hiddenRow] = rows();
    expect(publicRow.props['data-good-bulk-row']).toBe('ready');
    expect(text(publicRow.props.children as ReactNode)).not.toContain('비공개');
    expect(hiddenRow.props['data-good-bulk-row']).toBe('ready');
    expect(text(hiddenRow.props.children as ReactNode)).toContain('추가 가능');
    const note = nodes(hiddenRow.props.children as ReactNode).find(node => node.props['data-good-visibility'] === 'unpublished')!;
    expect(text(note.props.children as ReactNode)).toBe('비공개공개 전까지 고객 화면에 보이지 않습니다.');
    expect(render().some(node => node.props.role === 'status' && text(node.props.children as ReactNode).includes('추가 가능 2개 (비공개 1개 포함)'))).toBe(true);

    addAll();
    expect(options.onAdd).toHaveBeenCalledWith(['qa-pr1', 'qa-pr9']);
    const message = render().filter(node => node.props.role === 'status').map(node => text(node.props.children as ReactNode)).join('\n');
    expect(message).toContain('2개를 선택에 담았습니다. 그중 비공개 1개는 공개 전까지 고객 화면에 보이지 않습니다. 선택 완료를 눌러 반영해주세요.');
  });

  it('홈 전시처럼 선택기가 공개 여부를 따로 판정하면 그 판정을 따른다', async () => {
    options = { ...options, classify: found => ({ ok: true, id: found.id, item: found.id, unpublished: found.id === 'qa-pr1' }) };
    mocks.resolve.mockResolvedValueOnce({ ok: true, matches: [match('QA-PR1'), match('QA-PR9', { published: false })] });
    await paste('QA-PR1\nQA-PR9');
    const [first, second] = rows();
    expect(text(first.props.children as ReactNode)).toContain('비공개');
    expect(text(second.props.children as ReactNode)).not.toContain('비공개');
  });
});

describe('여러 상품 한 번에 추가 — 한도 초과(QA1 MD minor)', () => {
  it('지금 담을 수 있는 수를 넘는 줄은 이름과 함께 알리고, 줄마다 한도 초과로 남기며 입력 칸에 되돌린다', async () => {
    options = { ...options, capacity: 2 };
    mocks.resolve.mockResolvedValueOnce({ ok: true, matches: [match('QA-PR1'), match('QA-PR2'), match('QA-PR10', { name: 'QA 기획 컵' })] });
    await paste('QA-PR1\nQA-PR2\nQA-PR10');
    addAll();
    expect(options.onAdd).toHaveBeenCalledWith(['qa-pr1', 'qa-pr2']);
    const left = rows();
    expect(left).toHaveLength(1);
    expect(left[0].props['data-good-bulk-row']).toBe('overLimit');
    expect(text(left[0].props.children as ReactNode)).toContain('한도 초과');
    expect(text(left[0].props.children as ReactNode)).toContain('QA 기획 컵 · QA-PR10');
    expect(text(left[0].props.children as ReactNode)).toContain('지금 담을 수 있는 수(2개)를 넘어 담지 않았습니다.');
    expect(render().find(node => node.type === Textarea)!.props.value).toBe('QA-PR10');
    const message = render().filter(node => node.props.role === 'status').map(node => text(node.props.children as ReactNode)).join('\n');
    expect(message).toContain('2개를 선택에 담았습니다. 지금 담을 수 있는 수(2개)를 넘는 1개는 담지 않았습니다: QA 기획 컵 · QA-PR10. 아래 목록과 입력 칸에 남겨 두었습니다.');
    /* 한도 초과 줄은 담기 대상이 아니다 — 선택을 줄인 뒤 다시 확인해야 담긴다. */
    expect(render().find(node => node.type === Button && text(node.props.children as ReactNode) === '추가 가능한 0개 담기')!.props.disabled).toBe(true);
  });

  it('더 담을 자리가 없으면 아무것도 담지 않고 줄마다 한도 초과로 바꾼다', async () => {
    options = { ...options, capacity: 0 };
    mocks.resolve.mockResolvedValueOnce({ ok: true, matches: [match('QA-PR1')] });
    await paste('QA-PR1');
    addAll();
    expect(options.onAdd).not.toHaveBeenCalled();
    expect(rows().map(row => row.props['data-good-bulk-row'])).toEqual(['overLimit']);
    expect(render().some(node => node.props.role === 'status' && text(node.props.children as ReactNode).includes('지금 담을 수 있는 수가 0개라 담지 않았습니다(QA 상품 QA-PR1 · QA-PR1).'))).toBe(true);
  });
});
