import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminOpenInquiryBadge } from './AdminOpenInquiryBadge';

describe('unanswered inquiry shell badge', () => {
  it('omits the empty slot and links a nonzero count to the unanswered queue', () => {
    expect(renderToStaticMarkup(<AdminOpenInquiryBadge count={0} />)).toBe('');
    const html=renderToStaticMarkup(<AdminOpenInquiryBadge count={10} />);
    expect(html).toContain('href="/admin/cs/inquiries?status=open&amp;page=1"');
    expect(html).toContain('class="admin-shell-badge"');
    expect(html).toContain('<span>미답변 1:1 문의</span>');
    expect(html).toContain('<strong>10건</strong>');
  });
});
