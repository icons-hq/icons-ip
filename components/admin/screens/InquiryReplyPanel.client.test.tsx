import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 코드 리뷰 결함: 답변 완료 문의에서 추가 답변을 쓰는 중에 고객이 다시 물으면 실시간 갱신으로 answered가 뒤집힌다.
 * 작성칸이 트리의 다른 자리로 옮겨지면 다시 그려져 고른 첨부가 사라지고, 문구는 부모 상태라 남아 첨부 없이 발송될 수 있다.
 */

const mocks = vi.hoisted(() => ({ body: '' }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
    useId: () => 'panel',
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [initial, vi.fn()],
  };
});
vi.mock('@/app/admin/inquiry-actions', () => ({ answerInquiryAction: vi.fn(), closeInquiryAction: vi.fn() }));
vi.mock('@/components/admin/useInquiryDraft', () => ({
  useInquiryDraft: () => ({ body: mocks.body, change: vi.fn(), ready: true, blocked: false, recovery: null }),
}));
vi.mock('./InquiryReplyTemplateTools', () => ({ InquiryReplyTemplateTools: () => null }));
vi.mock('./InquiryDraftNotice', () => ({ InquiryDraftNotice: () => null }));
vi.mock('./CustomerServiceDialog', () => ({ useInquiryPreviewBusy: () => undefined }));

import { InquiryReplyPanel } from './InquiryReplyPanel';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

function slots(answered: boolean) {
  const section = InquiryReplyPanel({ category: 'order', closed: false, answered, inquiryId: 'inquiry-1' }) as Element;
  return section.props.children as (Element | null)[];
}
const composerSlot = (children: (Element | null)[]) => children.findIndex((child) => isValidElement(child) && child.props.id === 'panel-composer');

describe('InquiryReplyPanel 작성칸 자리', () => {
  beforeEach(() => { mocks.body = ''; });

  it('문의 상태가 뒤집혀도 작성칸은 같은 자리에 남아 첨부가 사라지지 않는다', () => {
    mocks.body = '쓰던 답변';
    const answered = slots(true), open = slots(false);

    expect(answered).toHaveLength(open.length);
    expect(composerSlot(answered)).toBeGreaterThan(-1);
    expect(composerSlot(open)).toBe(composerSlot(answered));
    expect(answered[composerSlot(answered)]!.type).toBe(open[composerSlot(open)]!.type);
  });

  it('답변 완료 문의는 쓰던 내용이 없을 때만 작성칸을 감추고, 미답변 문의는 감추지 않는다', () => {
    expect(slots(true)[composerSlot(slots(true))]!.props.hidden).toBe(true);
    expect(slots(false)[composerSlot(slots(false))]!.props.hidden).toBe(false);

    mocks.body = '쓰던 답변';
    expect(slots(true)[composerSlot(slots(true))]!.props.hidden).toBe(false);
  });
});
