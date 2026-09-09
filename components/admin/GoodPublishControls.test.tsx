import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoodPublishControls } from './GoodPublishControls';
describe('상품 게시 상태 화면', () => {
  it('공개 상품을 내릴 때 기존 주문 유지와 확인 단계를 보여준다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt="2026-09-08" archivedAt={null}/>);
    expect(html).toContain('초안으로 되돌리기'); expect(html).toContain('기존 주문');
    expect(html).toContain('name="confirmUnpublish"'); expect(html).toContain('required=""');
  });
  it('보관 상품은 복원 안내를 표시하고 게시 버튼을 제공하지 않는다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt="2026-09-08"/>);
    expect(html).toContain('복원하면 초안'); expect(html).not.toContain('<button');
  });
});
