/*
 * 카카오 알림톡 주문 안내 템플릿(정본).
 *
 * 알림톡은 카카오가 심사해 승인한 템플릿 본문만 보낼 수 있고, 앱은 템플릿 코드와 #{변수} 값만 넘긴다. 아래 본문·버튼은
 * NHN Cloud 콘솔에 등록할 초안이며 docs/runbooks/kakao-alimtalk.md가 같은 글을 싣는다(templates.test.ts가 대조한다).
 * 본문을 바꾸면 카카오 재심사가 필요하다 — 승인된 본문과 이 파일이 다르면 발송이 템플릿 불일치로 거절된다.
 *
 * 쓰는 원칙(알림톡 심사: 정보성 메시지만):
 *   · 주문·배송 사실만 담는다. 쿠폰·이벤트·추천 같은 광고성 문구를 넣지 않는다.
 *   · 받는 사람의 이름·주소·연락처를 담지 않는다(닉네임은 실명이 아니고, 주소는 받는 분 정보다).
 *   · 링크는 고정 도메인(xsquare.kr — 전환 전에는 iconsip.com으로 경로를 유지한 채 넘어간다)에 주문 id만 바꾼다.
 */

export type AlimtalkTemplateName = 'order_confirmation' | 'order_shipped';

export interface AlimtalkTemplateDraft {
  /** NHN 콘솔에 넣을 템플릿 코드 제안(최대 20자). 실제 코드는 env로 받는다. */
  suggestedCode: string;
  name: string;
  body: string;
  buttons: readonly { type: 'WL' | 'DS'; name: string; linkMo?: string; linkPc?: string }[];
  /** 본문·버튼 링크에 쓰인 #{변수}. 발송 때 정확히 이 키들을 채운다. */
  variables: readonly string[];
}

const ORDER_LINK = 'https://xsquare.kr/orders/#{주문ID}';

export const ALIMTALK_TEMPLATES: Record<AlimtalkTemplateName, AlimtalkTemplateDraft> = {
  order_confirmation: {
    suggestedCode: 'XSQ_ORDER_PAID',
    name: '주문 접수 안내',
    body: [
      '[X SQUARE] 주문 접수 안내',
      '',
      '주문이 접수됐어요.',
      '결제가 확인되어 배송 준비를 시작합니다.',
      '',
      '■ 주문번호: #{주문번호}',
      '■ 주문 굿즈: #{굿즈명}',
      '■ 결제금액: #{결제금액}원',
      '',
      '굿즈가 발송되면 다시 알려 드릴게요.',
    ].join('\n'),
    buttons: [{ type: 'WL', name: '주문 상세 보기', linkMo: ORDER_LINK, linkPc: ORDER_LINK }],
    variables: ['주문번호', '굿즈명', '결제금액', '주문ID'],
  },
  order_shipped: {
    suggestedCode: 'XSQ_ORDER_SHIPPED',
    name: '굿즈 발송 안내',
    body: [
      '[X SQUARE] 굿즈 발송 안내',
      '',
      '주문하신 굿즈가 발송됐어요.',
      '',
      '■ 주문번호: #{주문번호}',
      '■ 발송 굿즈: #{굿즈명}',
      '■ 택배사: #{택배사}',
      '■ 송장번호: #{송장번호}',
      '',
      '아래 [배송 조회] 버튼으로 배송 현황을 확인할 수 있어요.',
    ].join('\n'),
    buttons: [
      { type: 'DS', name: '배송 조회' },
      { type: 'WL', name: '주문 상세 보기', linkMo: ORDER_LINK, linkPc: ORDER_LINK },
    ],
    variables: ['주문번호', '굿즈명', '택배사', '송장번호', '주문ID'],
  },
};

/** 굿즈명 변수 한 칸의 최대 길이. 넘치면 말줄임한다(본문이 휴대폰 한 화면 안에 들게). */
export const ALIMTALK_ITEM_SUMMARY_MAX = 40;

/** '첫 굿즈 외 N건'. 이름이 길면 말줄임하되 '외 N건'은 남긴다. */
export function alimtalkItemSummary(names: readonly string[]): string {
  const cleaned = names.map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!cleaned.length) return '주문 굿즈';
  const suffix = cleaned.length > 1 ? ` 외 ${cleaned.length - 1}건` : '';
  const room = ALIMTALK_ITEM_SUMMARY_MAX - suffix.length;
  const first = [...cleaned[0]];
  const head = first.length > room ? `${first.slice(0, Math.max(1, room - 1)).join('')}…` : cleaned[0];
  return `${head}${suffix}`;
}

export function alimtalkAmount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('ko-KR');
}

export function orderConfirmationParameters(input: {
  orderId: string;
  orderReference: string;
  itemNames: readonly string[];
  total: number;
}): Record<string, string> {
  return {
    주문번호: input.orderReference,
    굿즈명: alimtalkItemSummary(input.itemNames),
    결제금액: alimtalkAmount(input.total),
    주문ID: input.orderId,
  };
}

export function orderShippedParameters(input: {
  orderId: string;
  orderReference: string;
  itemNames: readonly string[];
  carrierLabel: string;
  trackingNumber: string;
}): Record<string, string> {
  return {
    주문번호: input.orderReference,
    굿즈명: alimtalkItemSummary(input.itemNames),
    택배사: input.carrierLabel.trim(),
    송장번호: input.trackingNumber.trim(),
    주문ID: input.orderId,
  };
}
