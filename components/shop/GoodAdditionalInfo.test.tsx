import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BusinessInfo } from '@/lib/legal/business-info';
import { GoodAdditionalInfo } from './GoodAdditionalInfo';

const good = { id: 'g13', name: '아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null, stock: 'ok' as const, stockQty: 8, img: '' };
const notice = <p>고시정보 표</p>;
const blankSeller: BusinessInfo = { companyName: '', representative: '', registrationNumber: '', mailOrderNumber: '', address: '', phone: '', email: '', hostingProvider: '' };

describe('GoodAdditionalInfo', () => {
  it('고시정보·배송 안내·교환/반품 안내·판매자 정보를 접힌 아코디언 4개로 둔다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} />);

    expect(html.match(/<details class="wc-pdp-info__item">/g)).toHaveLength(4);
    expect(html).not.toContain(' open=""');
    expect(html).toContain('<div aria-labelledby="pdp-notice-heading" class="wc-pdp-info__body" role="group"><p>고시정보 표</p></div>');
    for (const title of ['고시정보', '배송 안내', '교환 · 반품 안내', '판매자 정보']) expect(html).toContain(`">${title}</span></summary>`);
    /* 펼친 본문은 펼침 제목으로 이름 붙은 묶음이다. */
    expect(html).toContain('<div aria-labelledby="pdp-seller-heading" class="wc-pdp-info__body" role="group">');
  });

  /* 사업자 정보 확정 전(#239)에는 있는 값만 보인다 — 빈 칸은 행이 사라지고, 다 비면 절을 두지 않는다. */
  it('판매자 정보는 공개 사업자 정보의 있는 값만, 다 비면 절째 숨긴다', () => {
    const partial = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} sellerInfo={{ ...blankSeller, companyName: '(주)아이콘스', registrationNumber: '109-86-27576' }} />);
    const seller = partial.slice(partial.indexOf('pdp-seller-heading'));
    expect(seller).toContain('<tr><th scope="row">상호</th><td>(주)아이콘스</td></tr>');
    expect(seller).toContain('<tr><th scope="row">사업자등록번호</th><td>109-86-27576</td></tr>');
    expect(seller).not.toContain('대표자');
    expect(seller).not.toContain('통신판매업 신고번호');

    const blank = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} sellerInfo={blankSeller} />);
    expect(blank).not.toContain('판매자 정보');
    expect(blank.match(/<details class="wc-pdp-info__item">/g)).toHaveLength(3);
  });
});
