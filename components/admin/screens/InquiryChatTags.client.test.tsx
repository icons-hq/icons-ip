import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryChatTags } from './InquiryChatTags';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, pending: Promise.resolve(), mutate: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (hooks.states[index] === undefined) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
  useTransition: () => [false, (callback: () => Promise<void>) => { hooks.pending = callback(); }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/admin/inquiry-chat-actions', () => ({ updateInquiryChatTagAction: hooks.mutate }));
interface TestProps {
  children?: ReactNode;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
}
function elements(node: ReactNode, tag: string): ReactElement<TestProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, tag));
  if (!isValidElement<TestProps>(node)) return [];
  return [...(node.type === tag ? [node] : []), ...elements(node.props.children, tag)];
}
function render() {
  hooks.cursor = 0;
  return InquiryChatTags({ accountId: 'a20c0000-0000-4000-8000-000000000002', inquiryId: 'a20c0000-0000-4000-8000-000000000201', tags: ['기존 태그'] });
}
beforeEach(() => { hooks.states = []; hooks.cursor = 0; hooks.pending = Promise.resolve(); vi.clearAllMocks(); });
describe('상담 태그 네트워크 실패 복구', () => {
  it('요청 Promise가 거절되어도 입력과 기존 태그를 보존하고 재시도한다', async () => {
    hooks.mutate.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    elements(render(), 'input')[0].props.onChange?.({ target: { value: '보존할 태그' } });
    elements(render(), 'form')[0].props.onSubmit?.({ preventDefault: vi.fn() });
    await hooks.pending;
    const failed = renderToStaticMarkup(render());
    expect(failed).toContain('value="보존할 태그"'); expect(failed).toContain('기존 태그');
    expect(failed).toContain('입력은 유지됩니다'); expect(hooks.refresh).not.toHaveBeenCalled();
    hooks.mutate.mockResolvedValueOnce({});
    elements(render(), 'form')[0].props.onSubmit?.({ preventDefault: vi.fn() });
    await hooks.pending;
    expect(hooks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ label: '보존할 태그', present: true }));
    expect(renderToStaticMarkup(render())).toContain('value=""'); expect(hooks.refresh).toHaveBeenCalledOnce();
  });
});
