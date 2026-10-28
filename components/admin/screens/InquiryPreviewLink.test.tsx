import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', async () => {
  const actual = await vi.importActual<typeof import('next/link')>('next/link');
  return { ...actual, useLinkStatus: () => ({ pending: mocks.pending }) };
});

import { InquiryPreviewLink } from './InquiryPreviewLink';

describe('InquiryPreviewLink', () => {
  beforeEach(() => { mocks.pending = false; });

  /* R4: 상세 팝업을 서버에서 읽는 동안에도 클릭이 먹혔다는 표시가 즉시 보여야 한다. */
  it('누른 직후 이동이 끝나기 전까지 여는 중을 알린다', () => {
    const idle = renderToStaticMarkup(<InquiryPreviewLink className="admin-cs-open" href="/admin/cs/inquiries?inquiryId=a">답변처리</InquiryPreviewLink>);
    expect(idle).toContain('href="/admin/cs/inquiries?inquiryId=a"');
    expect(idle).toContain('class="admin-cs-open"');
    expect(idle).toContain('답변처리');
    expect(idle).toContain('aria-live="polite"');
    expect(idle).not.toContain('여는 중');

    mocks.pending = true;
    const pending = renderToStaticMarkup(<InquiryPreviewLink className="admin-cs-open" href="/admin/cs/inquiries?inquiryId=a">답변처리</InquiryPreviewLink>);
    expect(pending).toContain('여는 중');
    expect(pending).toContain('data-pending="true"');
  });
});
