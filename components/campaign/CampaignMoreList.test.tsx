import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignMoreList } from './CampaignMoreList';

function items(count: number) {
  return Array.from({ length: count }, (_, index) => (
    <li className="item" key={index}><a href={`/events/c-${index}`}>{`캠페인 ${index}`}</a></li>
  ));
}

describe('CampaignMoreList', () => {
  /* 11 §6 B21 — 첫 화면은 10건, 버튼 라벨은 "더보기 (보이는 건수/전체)". */
  it('첫 묶음만 그리고 더보기에 보이는 건수와 전체를 함께 적는다', () => {
    const html = renderToStaticMarkup(<CampaignMoreList className="grid" items={items(23)} />);

    expect(html.match(/class="item"/g)).toHaveLength(10);
    expect(html).toContain('href="/events/c-9"');
    expect(html).not.toContain('href="/events/c-10"');
    expect(html).toContain('더보기 (10/23)');
    expect(html).toContain('class="wc-view-more"');
    expect(html).toContain('type="button"');
  });

  /* 페이지 주소를 바꾸지 않는 이어 붙이기다 — 링크가 아니라 버튼이다. */
  it('더보기는 주소를 바꾸는 링크가 아니다', () => {
    const html = renderToStaticMarkup(<CampaignMoreList items={items(11)} />);
    const more = html.slice(html.indexOf('wc-campaign-more'));

    expect(more).not.toContain('<a ');
    expect(more).toContain('더보기 (10/11)');
  });

  it('한 묶음 안에 다 들어가면 버튼이 없다', () => {
    const html = renderToStaticMarkup(<CampaignMoreList items={items(10)} />);

    expect(html.match(/class="item"/g)).toHaveLength(10);
    expect(html).not.toContain('wc-view-more');
  });

  it('묶음 크기를 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(<CampaignMoreList items={items(5)} pageSize={2} />);

    expect(html.match(/class="item"/g)).toHaveLength(2);
    expect(html).toContain('더보기 (2/5)');
  });
});
