import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PublicGoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { GoodAnnouncements } from './GoodAnnouncements';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const notice = (fields: Partial<PublicGoodsAnnouncement> = {}): PublicGoodsAnnouncement => ({ id: 'notice', title: '배송 일정', body: '금요일 출고', format: 'plain',
  category: 'shipping', device: 'all', placement: 'top', important: false, ...fields });
describe('공개 굿즈 공지', () => {
  it('서버가 고른 공지의 채널과 중요 표시를 전달하고 HTML을 다시 정리한다', () => {
    const html = renderToStaticMarkup(<GoodAnnouncements data={{ nextChangeAt: null, items: [notice({ body: '<p onclick="bad()">금요일 출고</p><script>bad()</script>', format: 'html', device: 'mobile', important: true })] }} />);
    expect(html).toContain('data-pc="false"'); expect(html).toContain('data-mobile="true"'); expect(html).toContain('data-device="mobile"');
    expect(html).toContain('중요'); expect(html).toContain('금요일 출고'); expect(html).not.toMatch(/onclick|<script\b|bad\(\)/);
  });
  it('공지 없음과 조회 실패를 구별한다', () => {
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ items: [], nextChangeAt: null }} />)).toBe('');
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ items: [], nextChangeAt: null, unavailable: true }} />)).toContain('불러오지 못했습니다');
  });
  /* 1027T-005: 같은 조회 결과를 위치마다 나눠 그린다. 조회 실패 안내는 상단 한 곳만 말한다. */
  it('상단은 상단 공지만 굿즈 공지사항으로, 하단은 하단 공지만 굿즈 안내로 그린다', () => {
    const data = { nextChangeAt: null, items: [notice({ id: 'top', title: '휴무 안내' }), notice({ id: 'bottom', title: '교환·반품·배송 안내', placement: 'bottom', device: 'pc' })] };
    const top = renderToStaticMarkup(<GoodAnnouncements data={data} />);
    const bottom = renderToStaticMarkup(<GoodAnnouncements data={data} placement="bottom" />);
    expect(top).toContain('<h2>굿즈 공지사항</h2>'); expect(top).toContain('휴무 안내'); expect(top).not.toContain('교환·반품·배송 안내');
    expect(top).toContain('data-placement="top"');
    expect(bottom).toContain('<h2>굿즈 안내</h2>'); expect(bottom).toContain('교환·반품·배송 안내'); expect(bottom).not.toContain('휴무 안내');
    expect(bottom).toContain('data-placement="bottom"'); expect(bottom).toContain('data-mobile="false"');
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ ...data, items: [data.items[0]] }} placement="bottom" />)).toBe('');
    expect(renderToStaticMarkup(<GoodAnnouncements data={{ items: [], nextChangeAt: null, unavailable: true }} placement="bottom" />)).toBe('');
  });
});
