import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';

const mocks = vi.hoisted(() => ({ body: '', states: [] as unknown[], index: 0 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/inquiry-actions', () => ({ closeInquiryAction: vi.fn() }));
vi.mock('@/app/admin/inquiry-file-actions', () => ({ sendInquiryChatMessageAction: vi.fn() }));
vi.mock('@/components/admin/useInquiryDraft', () => ({ useInquiryDraft: () => ({ body: mocks.body, ready: true, blocked: false, recovery: null, unavailable: false, saved: false, change: vi.fn(), restore: vi.fn(), discard: vi.fn() }) }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
    useEffect: () => {},
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [mocks.states[index], vi.fn()];
    },
  };
});

import { InquiryChatConversation } from './InquiryChatConversation';

type Element = ReactElement<Record<string, unknown>>;
const detail = { inquiry: { id: 'a20c0000-0000-4000-8000-000000000201', reference: 1, title: '합성 배송 문의', category: 'order', status: 'open', buyerName: '합성 고객',
  assigneeId: null, assigneeName: null }, messages: [] } as unknown as AdminInquiryDetail;
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function textarea() {
  mocks.index = 0;
  const found = nodes(InquiryChatConversation({ accountId: 'staff', detail }) as Element).find(node => node.type === 'textarea');
  if (!found) throw new Error('Missing composer');
  return found;
}
function press(init: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }) {
  const requestSubmit = vi.fn(); const preventDefault = vi.fn();
  (textarea().props.onKeyDown as (event: unknown) => void)({
    key: init.key ?? 'Enter', shiftKey: init.shiftKey ?? false, altKey: false, ctrlKey: false, metaKey: false, keyCode: init.keyCode ?? 13,
    nativeEvent: { isComposing: init.isComposing ?? false }, preventDefault, currentTarget: { form: { requestSubmit } },
  });
  return { requestSubmit, preventDefault };
}

beforeEach(() => { mocks.states = []; mocks.index = 0; mocks.body = '배송 준비 중입니다.'; });

/* R5(MD-0022): 상담하기는 Enter 전송·Shift+Enter 줄바꿈이고, 한글 조합 중 Enter는 글자 확정에만 쓴다. */
describe('상담하기 입력 키 동작 (R5)', () => {
  it('Enter는 같은 폼으로 전송하고 줄바꿈을 넣지 않는다', () => {
    const result = press({});
    expect(result.preventDefault).toHaveBeenCalledOnce();
    expect(result.requestSubmit).toHaveBeenCalledOnce();
  });

  it('Shift+Enter는 줄바꿈으로 남긴다', () => {
    const result = press({ shiftKey: true });
    expect(result.preventDefault).not.toHaveBeenCalled();
    expect(result.requestSubmit).not.toHaveBeenCalled();
  });

  it('한글 조합 중 Enter는 전송하지 않고 조합 확정을 막지 않는다', () => {
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      const result = press(composing);
      expect(result.preventDefault).not.toHaveBeenCalled();
      expect(result.requestSubmit).not.toHaveBeenCalled();
    }
  });

  it('보낼 내용이 없으면 Enter로 빈 메시지를 보내지 않는다', () => {
    mocks.body = '   ';
    const result = press({});
    expect(result.requestSubmit).not.toHaveBeenCalled();
  });

  it('다른 키에는 관여하지 않는다', () => {
    const result = press({ key: 'a' });
    expect(result.preventDefault).not.toHaveBeenCalled();
    expect(result.requestSubmit).not.toHaveBeenCalled();
  });
});
