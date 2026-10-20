import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewEventBanner, ReviewEventDisclosureNote } from './ReviewEventBanner';
import { newReviewEventValues } from '@/lib/review-events';
describe('review event public notices', () => {
  it('never implies every review earns a benefit and previews do not navigate', () => {
    const event = { ...newReviewEventValues('2026-10-13'), id: 'event', state: 'active' as const, announcedAt: null, nextChangeAt: null };
    const html = renderToStaticMarkup(<ReviewEventBanner event={event} />);
    expect(html).toContain('선정 시 적립금'); expect(html).toContain('별점과 무관하게 선정'); expect(html).toContain('작성만으로 지급되지 않습니다');
    expect(renderToStaticMarkup(<ReviewEventBanner event={event} preview />)).not.toContain('href=');
  });
  it('keeps the incentive disclosure after a reward is reversed and distinguishes failed lookups', () => {
    expect(renderToStaticMarkup(<ReviewEventDisclosureNote value={{ eventTitle: '이벤트', revoked: true }} />)).toContain('혜택을 받았습니다. 이후 혜택이 회수되었습니다.');
    expect(renderToStaticMarkup(<ReviewEventDisclosureNote value={{ eventTitle: '', revoked: false, unavailable: true }} />)).toContain('확인하지 못했습니다');
    expect(renderToStaticMarkup(<ReviewEventDisclosureNote />)).toBe('');
  });
});
