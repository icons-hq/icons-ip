import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodAnnouncements } from './GoodAnnouncements';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe('공개 굿즈 공지', () => {
  it('서버가 고른 공지의 채널과 중요 표시를 전달하고 HTML을 다시 정리한다', () => {
    const html = renderToStaticMarkup(<GoodAnnouncements data={{ nextChangeAt: null, items: [{ id: 'notice', title: '배송 일정', body: '<p onclick="bad()">금요일 출고</p><script>bad()</script>', format: 'html', category: 'shipping', device: 'mobile', important: true }] }} />);
    expect(html).toContain('data-pc="false"'); expect(html).toContain('data-mobile="true"'); expect(html).toContain('data-device="mobile"');
    expect(html).toContain('중요'); expect(html).toContain('금요일 출고'); expect(html).not.toMatch(/onclick|<script\b|bad\(\)/);
  });
  it('공지 없음과 조회 실패를 구별한다', () => {
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ items: [], nextChangeAt: null }} />)).toBe('');
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ items: [], nextChangeAt: null, unavailable: true }} />)).toContain('불러오지 못했습니다');
  });
});
