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

  /* R26·R27(D4①): 고객 화면은 '출고지' 대신 배송 묶음·택배사로 말한다. 따로 붙는 배송비의 이유는 택배사다. */
  it('배송 안내는 출고지 대신 배송 묶음·택배사로 말한다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} />);
    const preorder = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[{ ...good, options: [{ id: '00000000-0000-4000-8000-000000000001', name: '예약', code: 'P1', price: 12000, stockQty: 0, isDefault: true, attributes: {},
      supply: { mode: 'preorder', expectedShipDate: '2026-12-01', availableQty: 5, saleStatus: 'open', saleEndsAt: null } }] } as never]} />);
    for (const markup of [html, preorder]) expect(markup).not.toContain('출고지');
    expect(html).toContain('택배사가 달라 따로 배송되는 굿즈의 배송비는 각각 더합니다.');
    expect(preorder).toContain('같은 배송 묶음의 일반 굿즈와 예약 굿즈를 함께 주문하면');
  });

  /* S36-038: 지역 정책이 있는 출고지 굿즈는 지역별 추가 배송비를 싣고, 없으면 지금 문장 그대로다. 템플릿의 도서산간 안내는 그대로 보인다. */
  it('배송 안내에 지역별 추가 배송비와 템플릿 도서산간 안내를 싣는다', () => {
    const policy = { originId: 'origin', originName: '김포', baseFee: 3000, freeThreshold: 30000, feeType: 'policy' as const, individualFee: 0 };
    const plainSentence = '배송지에 따른 추가 배송비는 주문서에서 주소를 입력한 뒤 확인합니다. 배송 가능 여부와 최종 배송비를 확인해야 주문할 수 있습니다.';
    const plain = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} shippingPolicy={policy} />);
    expect(plain).toContain(plainSentence);
    expect(plain).not.toContain('지역별 추가 배송비');
    const none = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} shippingPolicy={{ ...policy, remoteAreaNotice: '',
      regionFees: { state: 'none', regions: [], regionCount: 0, feeUnit: null, waivedAtFreeThreshold: false, nextChangeAt: null } }} />);
    expect(none).toBe(plain);
    const listed = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} shippingPolicy={{ ...policy, remoteAreaNotice: '제주·도서산간은 1~2일 더 걸립니다.\n일부 섬은 배송이 제한될 수 있습니다.',
      regionFees: { state: 'listed', regions: [{ label: '제주', minFee: 3000, maxFee: 3000 }, { label: '도서산간', minFee: 5000, maxFee: 5000 }], regionCount: 2, feeUnit: 'per_shipment',
        waivedAtFreeThreshold: true, nextChangeAt: null } }} />);
    expect(listed).toContain('<li>지역별 추가 배송비: 제주 +₩3,000 · 도서산간 +₩5,000(배송 묶음당 1회, 무료배송 조건을 채우면 면제). 최종 배송비는 주문서에서 주소를 입력한 뒤 확인합니다. 배송 가능 여부와 최종 배송비를 확인해야 주문할 수 있습니다.</li>');
    expect(listed).not.toContain(plainSentence);
    expect(listed).toContain('<li style="white-space:pre-wrap">제주·도서산간은 1~2일 더 걸립니다.\n일부 섬은 배송이 제한될 수 있습니다.</li>');
    /* 고객 화면은 출고지 이름을 말하지 않는다. */
    expect(listed).not.toContain('김포');
    /* 굿즈마다 부과하는 정책은 같은 금액에 단위를 굿즈당으로 밝힌다. */
    const perGood = renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} shippingPolicy={{ ...policy,
      regionFees: { state: 'listed', regions: [{ label: '제주', minFee: 3000, maxFee: 3000 }], regionCount: 1, feeUnit: 'per_good', waivedAtFreeThreshold: false, nextChangeAt: null } }} />);
    expect(perGood).toContain('<li>지역별 추가 배송비: 제주 +₩3,000(굿즈당 1회). 최종 배송비는 주문서에서 주소를 입력한 뒤 확인합니다.');
    expect(perGood).not.toContain('배송 묶음당 1회');
  });

  /* S36-040·S36-044: 교환·반품지는 굿즈가 고른 반품지(없으면 출고지 반품 주소, DB가 정한다)이고, 가능/제한은 조건에서 파생한다.
     제한 표시는 신청을 막지 않고, 하자·오배송은 제한할 수 없다는 문장을 함께 둔다. */
  it('교환·반품 안내에 반품지와 가능/제한 표시를 싣고 제한 상품도 신청할 수 있다고 말한다', () => {
    const terms = { returnAllowed: null, exchangeAllowed: true, restrictionReason: null, returnFee: 3000, returnFreeShippingFee: null, exchangeFee: 6000 };
    const policy = { originId: 'origin', originName: '김포', baseFee: 3000, freeThreshold: 30000, feeType: 'policy' as const, individualFee: 0,
      returnAddress: '서울특별시 합성구 반품로 1', claimPolicy: terms };
    const returnSection = (html: string) => html.slice(html.indexOf('pdp-return-heading'), html.indexOf('pdp-seller-heading'));
    const available = returnSection(renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} shippingPolicy={policy} />));
    expect(available).toContain('<li data-claim-availability="available" style="white-space:pre-wrap"><strong>교환·반품 가능</strong></li>');
    expect(available).toContain('<li>굿즈 하자·오배송은 교환·반품 제한과 관계없이 교환·반품할 수 있습니다.</li>');
    expect(available).toContain('<li>교환·반품지: 서울특별시 합성구 반품로 1 · 주문 상세에서 교환·반품을 신청하고 승인 안내를 받은 뒤 보내주세요.</li>');
    expect(available).not.toContain('<strong>교환·반품 제한');
    expect(available).not.toContain('김포');

    const restricted = returnSection(renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]}
      shippingPolicy={{ ...policy, claimPolicy: { ...terms, returnAllowed: false, exchangeAllowed: false, restrictionReason: '포장을 뜯으면 반품할 수 없습니다' } }} />));
    expect(restricted).toContain('<strong>교환·반품 제한(포장을 뜯으면 반품할 수 없습니다)</strong></li>');
    expect(restricted).toContain('제한된 굿즈도 주문 상세에서 교환·반품을 신청할 수 있고, 담당자가 개별 확인합니다. 굿즈 하자·오배송은 교환·반품 제한과 관계없이 교환·반품할 수 있습니다.');
    /* 사유가 제한 표시에 들어가므로 '굿즈별 확인 조건'으로 한 번 더 쓰지 않는다. */
    expect(restricted).not.toContain('굿즈별 확인 조건');

    const returnOnly = returnSection(renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]}
      shippingPolicy={{ ...policy, claimPolicy: { ...terms, returnAllowed: false, restrictionReason: '위생용품' } }} />));
    expect(returnOnly).toContain('<strong>교환·반품 제한(위생용품)</strong> · 반품 제한 · 교환 가능</li>');

    /* 정책을 읽지 못하면 가능/제한을 말하지 않는다(지어낸 표시 없음). */
    const unknown = returnSection(renderToStaticMarkup(<GoodAdditionalInfo notice={notice} goods={[good]} />));
    expect(unknown).not.toContain('data-claim-availability');
  });
});
