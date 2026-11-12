import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RevenueTrend } from './RevenueTrend';

/* ADM-016 #4: 차트는 이름이 있는 이미지이고 Tab 정지가 아니며, 같은 값은 표로 읽을 수 있다. */
describe('RevenueTrend 접근성', () => {
  const data = [{ date: '2026-11-11', goods: 12000, tickets: 0 }, { date: '2026-11-12', goods: 0, tickets: 5000 }];

  it('차트를 이름 붙은 이미지로 두고 같은 값의 표를 화면 낭독기에 준다', () => {
    const html = renderToStaticMarkup(<RevenueTrend data={data} days={30} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="매출 추이 차트. 최근 30일 날짜별 상품·티켓 매출이며 같은 값은 아래 표에서 읽을 수 있습니다."');
    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain('매출 추이 값 (최근 30일, 결제 완료 기준)');
    expect(html).toContain('11.11');
    expect(html).toContain('11.12');
  });

  it('매출이 없으면 차트 대신 안내만 보이고 표를 만들지 않는다', () => {
    const html = renderToStaticMarkup(<RevenueTrend data={[{ date: '2026-11-11', goods: 0, tickets: 0 }]} days={7} />);
    expect(html).not.toContain('sr-only');
    expect(html).toContain('최근 7일 결제 완료 매출이 없습니다.');
  });
});
