import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), register: vi.fn(), push: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[],
  index: 0, refIndex: 0, work: [] as Promise<void>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/app/admin/order-actions', () => ({ bulkRegisterAdminOrderTrackingAction: mocks.register, previewAdminOrderTrackingImportAction: mocks.preview }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
  useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
}));
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { DispatchTrackingImportPanel } from './DispatchTrackingImportPanel';

/*
 * QA 라운드 1 m2: 잘못 고른 회신 파일이 바로 등록되지 않도록, 읽기만 하는 [등록 전 확인]을 거쳐야 [일괄 등록]을 누를 수 있다.
 * 파일·붙여넣기·비밀번호가 바뀌면 확인 결과를 거두고 다시 확인하게 한다.
 */
type Element = ReactElement<Record<string, unknown>>;
/* 화면 안의 작은 부품(등록 전 확인 결과)도 펼쳐 본다. */
const expand = (node: Element): ReactNode => typeof node.type === 'function' && (node.type as { name?: string }).name === 'TrackingImportPreview'
  ? (node.type as (props: unknown) => ReactNode)(node.props) : node.props.children as ReactNode;
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(expand(node))] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(expand(node)) : String(node)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; return DispatchTrackingImportPanel({ carriers: [] }) as Element; }
const button = (label: string) => nodes(render()).find(node => node.type === Button && text(node.props.children as ReactNode) === label)!;
const submit = () => nodes(render()).find(node => node.type === Button && node.props.type === 'submit')!;
const preview = { format: '김포 WMS 21열', ready: 1, skipped: 1, issues: [], issueCount: 0, sample: [{ line: 3, reference: '2026111210000001', trackingNumber: '512345678906' }] };

beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.work = []; });
afterEach(() => vi.unstubAllGlobals());

it('등록 전 확인을 거쳐야 일괄 등록을 누를 수 있고, 고른 파일을 함께 읽는다', async () => {
  render();
  mocks.refs[1].current = {}; // 양식 요소
  const data = new FormData();
  vi.stubGlobal('FormData', vi.fn(function () { return data; }));
  expect(submit().props.disabled).toBe(true);
  const file = new File(['reply'], 'gimpo-reply.xlsx');
  const picker = nodes(render()).find(node => node.type === 'input' && node.props.type === 'file')!;
  (picker.props.onChange as (event: unknown) => void)({ target: { files: [file] } });
  expect(text(render())).toContain('gimpo-reply.xlsx');
  mocks.preview.mockResolvedValue({ preview });
  (button('등록 전 확인').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(mocks.preview).toHaveBeenCalledWith(data);expect(data.get('file')).toBe(file);
  expect(submit().props.disabled).toBe(false);
  const shown = text(render());
  expect(shown).toContain('김포 WMS 21열 · 등록할 줄 1 · 건너뛸 줄 1 · 등록할 수 없는 줄 0');
  expect(shown).toContain('512345678906');expect(shown).toContain('운송장 칸을 비운 줄은 아직 출고하지 않은 것으로 보고 등록하지 않습니다.');
  expect(mocks.register).not.toHaveBeenCalled();
});

it('비밀번호·파일이 바뀌면 확인 결과를 거두고, 읽지 못한 파일은 오류만 보이고 등록을 막는다', async () => {
  render();
  mocks.refs[1].current = {};
  const data = { set: vi.fn(), get: vi.fn() };
  vi.stubGlobal('FormData', vi.fn(function () { return data; }));
  mocks.preview.mockResolvedValue({ preview });
  (button('등록 전 확인').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(submit().props.disabled).toBe(false);
  const password = nodes(render()).find(node => node.type === Input && node.props.name === 'filePassword')!;
  (password.props.onChange as () => void)();
  expect(submit().props.disabled).toBe(true);
  mocks.preview.mockResolvedValue({ error: '파일 비밀번호가 맞지 않습니다. 파일을 내려받을 때 정한 비밀번호를 확인해주세요.' });
  (button('등록 전 확인').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(text(render())).toContain('파일 비밀번호가 맞지 않습니다.');expect(submit().props.disabled).toBe(true);
});
