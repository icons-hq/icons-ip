import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderStatement } from './OrderStatement';
import {
  STATEMENT_CANCELED_MESSAGE,
  STATEMENT_NOTICE_CARD_RECEIPT,
  STATEMENT_NOTICE_SCOPE,
  STATEMENT_NOTICE_VAT,
  STATEMENT_PENDING_MESSAGE,
  type OrderStatementModel,
} from '@/lib/orders/statement';

const ORDER_ID = '20000000-0000-4000-8000-000000002051';

function model(overrides: Partial<OrderStatementModel> = {}): OrderStatementModel {
  return {
    orderId: ORDER_ID,
    issuedOn: '2026년 11월 17일',
    orderNumber: '20261117140510000001',
    tradedAt: '2026. 11. 17. 14:05',
    paymentLabel: '신용·체크카드 (4330****)',
    supplier: [
      { label: '상호', value: '(주)아이콘스' },
      { label: '대표자', value: '정승준' },
      { label: '사업자등록번호', value: '109-86-27576' },
    ],
    buyer: [{ label: '주문자', value: '홍길동' }, { label: '이메일', value: 'hong@example.test' }],
    items: [
      { key: 'a', name: '홍실 아크릴 블록', option: '파랑', qty: 2, unitPrice: 10000, amount: 20000 },
      { key: 'b', name: '홍실 키링', option: '—', qty: 1, unitPrice: 8000, amount: 8000 },
    ],
    totals: [
      { key: 'goods', label: '굿즈 합계', amount: 28000, kind: 'plain' },
      { key: 'volume', label: '복수구매 할인', amount: 2000, kind: 'deduction' },
      { key: 'shipping', label: '배송비', amount: 3000, kind: 'plain' },
      { key: 'total', label: '총 결제 금액', amount: 29000, kind: 'total' },
    ],
    collectNotice: null,
    notices: [STATEMENT_NOTICE_VAT, STATEMENT_NOTICE_SCOPE, STATEMENT_NOTICE_CARD_RECEIPT],
    ...overrides,
  };
}

const render = (value: OrderStatementModel | null = model(), unavailableMessage?: string) =>
  renderToStaticMarkup(<OrderStatement orderId={ORDER_ID} model={value} unavailableMessage={unavailableMessage} />);

describe('OrderStatement', () => {
  it('제목·머리 표·공급자·공급받는자·품목 표·합계 표를 한 문서로 그린다', () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('거래명세서');
    for (const text of ['발행일', '2026년 11월 17일', '주문번호', '20261117140510000001', '거래일시', '2026. 11. 17. 14:05', '결제수단', '신용·체크카드 (4330****)']) expect(html).toContain(text);
    expect(html).toContain('공급자');
    expect(html).toContain('공급받는자');
    expect(html).toContain('(주)아이콘스');
    expect(html).toContain('hong@example.test');
    for (const header of ['품목', '옵션', '수량', '단가', '금액']) expect(html).toContain(`>${header}</th>`);
    expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('₩10,000');
    expect(html).toContain('₩20,000');
    expect(html).toContain('굿즈 합계');
    expect(html).toContain('총 결제 금액');
    expect(html).toContain('₩29,000');
  });

  it('차감 행은 −를 붙이고, 일반 행·합계 행에는 붙이지 않는다', () => {
    const html = render();
    expect(html).toContain('−₩2,000');
    expect(html).not.toContain('−₩3,000');
    expect(html).not.toContain('−₩29,000');
    expect(html).toContain('data-kind="total"');
  });

  it('공급자 빈 값 행은 모델에 없으므로 라벨만 남지 않는다', () => {
    const html = render(model({ supplier: [{ label: '상호', value: '(주)아이콘스' }] }));
    expect(html).toContain('(주)아이콘스');
    for (const label of ['대표자', '사업자등록번호', '통신판매업 신고번호', '전화']) expect(html).not.toContain(label);
  });

  it('안내 세 문장과 착불 한 줄을 그대로 그린다', () => {
    const html = render(model({ collectNotice: '착불 배송비 ₩3,000은 받을 때 따로 결제해요.' }));
    expect(html).toContain('모든 금액은 부가가치세가 포함된 금액입니다.');
    expect(html).toContain('이 거래명세서는 거래 내용 확인용이며 세금계산서·현금영수증을 대신하지 않습니다.');
    expect(html).toContain('카드 매출전표는 주문 상세의 ‘결제 영수증’에서 확인할 수 있어요.');
    expect(html).toContain('착불 배송비 ₩3,000은 받을 때 따로 결제해요.');
  });

  it('착불이 없으면 착불 줄이 없고, 카드 안내가 없는 모델이면 그 문장도 없다', () => {
    const html = render(model({ notices: [STATEMENT_NOTICE_VAT, STATEMENT_NOTICE_SCOPE] }));
    expect(html).not.toContain('wc-statement__collect');
    expect(html).not.toContain('결제 영수증');
  });

  it('화면 전용 버튼 둘(주문 상세로 돌아가기·인쇄하기)이 문서 밖 도구 줄에 있다', () => {
    const html = render();
    const toolbar = html.slice(html.indexOf('wc-statement-toolbar'), html.indexOf('<article'));
    expect(toolbar).toContain(`href="/orders/${ORDER_ID}"`);
    expect(toolbar).toContain('주문 상세로 돌아가기');
    expect(toolbar).toContain('<button type="button" class="wc-btn primary">인쇄하기</button>');
    expect(html.slice(html.indexOf('<article'))).not.toContain('인쇄하기');
  });

  it('결제 전 주문은 발급 안내와 주문 상세로 돌아가기만 보이고 명세서 문서는 없다', () => {
    const html = render(null, STATEMENT_PENDING_MESSAGE);
    expect(html).toContain('결제가 완료된 주문만 거래명세서를 발급해요.');
    expect(html).toContain(`href="/orders/${ORDER_ID}"`);
    expect(html).toContain('주문 상세로 돌아가기');
    expect(html).not.toContain('<article');
    expect(html).not.toContain('인쇄하기');
    expect(html).not.toContain('공급자');
  });

  it('취소된 주문은 취소 안내를 보인다', () => {
    const html = render(null, STATEMENT_CANCELED_MESSAGE);
    expect(html).toContain('취소된 주문은 거래명세서를 발급하지 않아요.');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('모델도 안내도 없으면 일반 안내를 보인다', () => {
    expect(render(null)).toContain('거래명세서를 발급할 수 없는 주문이에요.');
  });
});

describe('거래명세서 툴바 스타일 계약', () => {
  const css = readFileSync(new URL('../../app/styles/wc-order-statement.css', import.meta.url), 'utf8');

  it('파운데이션의 `.wc-btn + .wc-btn` 세로 간격(margin-top 7px)을 툴바 안에서 되돌려 두 버튼이 같은 높이에 선다', () => {
    /* 파운데이션 규칙(0,2,0)보다 선택자 강도가 높아야 한다 — 툴바 자식 결합자로 (0,3,0). */
    expect(css).toMatch(/\.wc-statement-toolbar > \.wc-btn \+ \.wc-btn \{\s*margin-top: 0;\s*\}/);
  });
});
