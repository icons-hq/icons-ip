import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { InquiryDraftNotice } from './InquiryDraftNotice';

type Draft = ReturnType<typeof useInquiryDraft>;
const draft = (overrides: Partial<Draft> = {}): Draft => ({
  body: '', recovery: null, ready: true, blocked: false, unavailable: false, saved: false,
  change: vi.fn(), restore: vi.fn(), discard: vi.fn(), ...overrides,
});

describe('InquiryDraftNotice', () => {
  /* R4: 초안 보관소가 준비되기 전에는 입력·버튼이 잠긴다. 이유 없이 잠기면 '무반응'으로 보인다. */
  it('초안 준비 전에는 답변 입력을 불러오는 중이라고 알린다', () => {
    const loading = renderToStaticMarkup(<InquiryDraftNotice draft={draft({ ready: false })} pending />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('답변 입력을 불러오는 중입니다.');

    const note = renderToStaticMarkup(<InquiryDraftNotice draft={draft({ ready: false })} pending loadingLabel="메모 입력을 불러오는 중입니다." />);
    expect(note).toContain('메모 입력을 불러오는 중입니다.');

    expect(renderToStaticMarkup(<InquiryDraftNotice draft={draft()} pending={false} />)).not.toContain('불러오는 중');
  });
});
