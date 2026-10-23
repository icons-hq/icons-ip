import type { CheckoutAddress } from '../checkout';
import { krw } from '../format';
import { formatOrderDateTime, LEGAL_WITHDRAWAL_NOTICE, orderReferenceLabel } from '../orders';
import type { GoodsTransactionDisplay } from '../goods-transaction';

/* 트랜잭션 이메일 본문(#180). 순수 함수다 — 네트워크·DB·env를 모르고 입력만 받는다.
 *
 * 메일 클라이언트는 브라우저가 아니다. Gmail은 <style>·<head>를 떼어내고 Outlook은
 * flex·grid·position을 무시한다. 그래서 앱의 "Holographic Midnight"을 그대로 옮기지 않고
 * table 레이아웃 + 인라인 스타일 + 밝은 배경이라는 메일 관용구를 쓴다. 강제 라이트 모드로
 * 렌더되는 클라이언트에서 어두운 서피스가 검게 뭉개지는 문제를 애초에 만들지 않는다. */

export interface OrderEmailItem {
  variantName?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface OrderConfirmationEmailInput {
  transaction?: GoodsTransactionDisplay;
  giftDelivery?: boolean;
  orderId: string;
  orderedAt: string;
  items: OrderEmailItem[];
  itemsSubtotal: number;
  shippingFee: number;
  discountTotal?: number;
  /** 주문에 사용한 적립금. 쿠폰 할인과 따로 적어야 굿즈 합계+배송비−할인이 총 결제금액과 맞는다. */
  storeCreditTotal?: number;
  total: number;
  address: CheckoutAddress | null;
  orderUrl: string;
}

export interface OrderShippedEmailInput {
  giftDelivery?: boolean;
  orderId: string;
  shipmentId: string;
  originName: string;
  items: OrderEmailItem[];
  address: CheckoutAddress | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  orderUrl: string;
}

const ACCENT = '#8B5CFF';
const INK = '#1B1633';
const MUTED = '#6B6685';
const LINE = '#E4E1F0';
const ADDRESS_FALLBACK = '배송지 정보를 확인할 수 없습니다. 주문 상세에서 확인해주세요.';
const TRACKING_FALLBACK = '운송장 정보가 등록되면 주문 상세에서 배송 조회를 할 수 있습니다.';
const GIFT_DELIVERY_PRIVATE = '선물 받는 분이 입력한 주소로 배송됩니다. 받는 분의 주소·연락처·운송장 정보는 구매자에게 공개되지 않습니다.';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 메일 본문 링크는 http(s)만 허용한다. javascript: 같은 스킴을 링크로 만들지 않는다. */
export function safeLinkUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function shippingFeeLabel(shippingFee: number) {
  return shippingFee > 0 ? krw(shippingFee) : '무료';
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function addressLines(address: CheckoutAddress | null): string[] {
  if (!address) return [ADDRESS_FALLBACK];
  const street = [address.address1, address.address2].filter(Boolean).join(' ');
  return [
    `${address.recipientName} · ${formatPhone(address.phone)}`,
    `(${address.postalCode}) ${street}`,
    ...(address.deliveryNote ? [`배송 메모: ${address.deliveryNote}`] : []),
  ];
}

function itemName(item: OrderEmailItem) {
  return item.variantName ? `${item.name} · ${item.variantName}` : item.name;
}

function itemLine(item: OrderEmailItem) {
  return `${itemName(item)} × ${item.qty}  ${krw(item.unitPrice * item.qty)}`;
}

function textBlock(lines: string[]) {
  return lines.filter((line) => line !== null && line !== undefined).join('\n');
}

function htmlHeading(text: string) {
  return `<tr><td style="padding:24px 24px 8px 24px;font-size:18px;font-weight:700;color:${INK};">${escapeHtml(text)}</td></tr>`;
}

function htmlParagraph(text: string, color = MUTED) {
  return `<tr><td style="padding:0 24px 12px 24px;font-size:13px;line-height:1.7;color:${color};">${escapeHtml(text)}</td></tr>`;
}

function htmlSectionTitle(text: string) {
  return `<tr><td style="padding:16px 24px 6px 24px;font-size:12px;font-weight:700;letter-spacing:.04em;color:${ACCENT};">${escapeHtml(text)}</td></tr>`;
}

function htmlDefinitionRows(rows: [string, string][]) {
  const cells = rows.map(([label, value]) => (
    `<tr>`
    + `<td style="padding:6px 0;font-size:13px;color:${MUTED};white-space:nowrap;">${escapeHtml(label)}</td>`
    + `<td align="right" style="padding:6px 0;font-size:13px;color:${INK};font-weight:600;">${escapeHtml(value)}</td>`
    + `</tr>`
  )).join('');
  return `<tr><td style="padding:0 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table></td></tr>`;
}

function htmlItemRows(items: OrderEmailItem[]) {
  const cells = items.map((item) => (
    `<tr>`
    + `<td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};">${escapeHtml(itemName(item))}<span style="color:${MUTED};"> × ${item.qty}</span></td>`
    + `<td align="right" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};font-weight:600;white-space:nowrap;">${escapeHtml(krw(item.unitPrice * item.qty))}</td>`
    + `</tr>`
  )).join('');
  return `<tr><td style="padding:0 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table></td></tr>`;
}

function htmlAddress(address: CheckoutAddress | null) {
  const lines = addressLines(address)
    .map((line) => `<div style="font-size:13px;line-height:1.7;color:${INK};">${escapeHtml(line)}</div>`)
    .join('');
  return `<tr><td style="padding:0 24px 4px 24px;">${lines}</td></tr>`;
}

function htmlButton(url: string, label: string) {
  return `<tr><td style="padding:20px 24px 4px 24px;">`
    + `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${ACCENT};color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(label)}</a>`
    + `</td></tr>`;
}

/* 푸터의 식별자 라벨은 메일마다 다르다. 주문 메일은 주문번호, 문의 답변 메일은
   문의번호다 — 라벨을 고정하면 문의 메일 푸터가 "주문번호 #12"라고 거짓말을 한다. */
function htmlDocument(reference: string, body: string, referenceLabel = '주문번호') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F4FA;padding:24px 0;">`
    + `<tr><td align="center">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${LINE};border-radius:14px;font-family:'Apple SD Gothic Neo',-apple-system,'Segoe UI',Roboto,sans-serif;">`
    + `<tr><td style="padding:24px 24px 0 24px;font-size:14px;font-weight:800;letter-spacing:.08em;color:${ACCENT};">ICONS</td></tr>`
    + body
    + `<tr><td style="padding:20px 24px 24px 24px;border-top:1px solid ${LINE};font-size:11px;line-height:1.7;color:${MUTED};">`
    + `${escapeHtml(referenceLabel)} ${escapeHtml(reference)} · 이 메일은 발신 전용입니다. 문의는 ICONS 1:1 문의로 보내주세요.`
    + `</td></tr>`
    + `</table></td></tr></table>`;
}

export function renderOrderConfirmationEmail(input: OrderConfirmationEmailInput): RenderedEmail {
  const reference = orderReferenceLabel(input.orderId);
  const orderedAt = formatOrderDateTime(input.orderedAt);
  const subject = `[ICONS] 주문이 접수됐어요 (주문번호 ${reference})`;
  const totals = input.transaction?.totals;
  const amountRows: [string, string][] = totals ? [
    ['굿즈 합계', krw(totals.subtotal)], ['복수구매 할인', `−${krw(totals.volumeDiscountTotal)}`],
    ['쿠폰 할인', `−${krw(totals.couponDiscountTotal)}`], ['적립금 사용', `−${krw(totals.storeCreditTotal)}`],
    ['선불 배송비', krw(totals.prepaidShippingTotal)], ['온라인 결제금액', krw(totals.onlineTotal)],
    ...(totals.collectShippingTotal > 0 ? [['착불 배송비 · 수령 시 별도', krw(totals.collectShippingTotal)], ['총 부담금액', krw(totals.customerTotal)]] as [string, string][] : []),
  ] : [
    ['굿즈 합계', krw(input.itemsSubtotal)], ['배송비', shippingFeeLabel(input.shippingFee)],
    ...(input.discountTotal ? [['쿠폰 할인', `−${krw(input.discountTotal)}`] as [string, string]] : []),
    ...(input.storeCreditTotal ? [['적립금 사용', `−${krw(input.storeCreditTotal)}`] as [string, string]] : []),
    ['총 결제금액', krw(input.total)],
  ];
  const collectLines = input.transaction?.shipping.flatMap(group => group.collector ? [
    `착불 수납 주체: ${group.collector.name} · ${group.collector.method}`, group.collector.instructions,
    `착불 배송비 환급 문의: ${group.collector.refundContact}`,
  ] : []) ?? [];

  const text = textBlock([
    'ICONS 주문이 접수됐어요.',
    '',
    `주문번호: ${reference}`,
    ...(orderedAt ? [`주문일시: ${orderedAt}`] : []),
    '',
    '[주문 굿즈]',
    ...input.items.map(itemLine),
    '',
    ...amountRows.map(([label, value]) => `${label}: ${value}`),
    ...collectLines,
    '',
    '[배송지]',
    ...(input.giftDelivery ? [GIFT_DELIVERY_PRIVATE] : addressLines(input.address)),
    '',
    '[청약철회 안내]',
    LEGAL_WITHDRAWAL_NOTICE,
    '',
    `주문 상세: ${input.orderUrl}`,
  ]);

  const html = htmlDocument(reference, [
    htmlHeading('주문이 접수됐어요'),
    htmlParagraph('결제가 확인됐고 배송 준비를 시작합니다. 아래는 계약내용에 관한 서면입니다.'),
    htmlSectionTitle('주문 정보'),
    htmlDefinitionRows([
      ['주문번호', reference],
      ...(orderedAt ? [['주문일시', orderedAt] as [string, string]] : []),
    ]),
    htmlSectionTitle('주문 굿즈'),
    htmlItemRows(input.items),
    htmlDefinitionRows(amountRows),
    ...collectLines.map(line => htmlParagraph(line)),
    htmlSectionTitle('배송지'),
    input.giftDelivery ? htmlParagraph(GIFT_DELIVERY_PRIVATE) : htmlAddress(input.address),
    htmlSectionTitle('청약철회 안내'),
    htmlParagraph(LEGAL_WITHDRAWAL_NOTICE, INK),
    htmlButton(input.orderUrl, '주문 상세 보기'),
  ].join(''));

  return { subject, text, html };
}

export function renderOrderShippedEmail(input: OrderShippedEmailInput): RenderedEmail {
  const reference = orderReferenceLabel(input.orderId);
  const subject = `[ICONS] ${input.originName} 굿즈가 배송을 시작했어요 (주문번호 ${reference})`;
  const carrierName = input.giftDelivery ? null : input.carrierName?.trim() || null;
  const trackingNumber = input.giftDelivery ? null : input.trackingNumber?.trim() || null;
  const trackingUrl = input.giftDelivery ? null : safeLinkUrl(input.trackingUrl);
  const hasTracking = Boolean(carrierName || trackingNumber);

  const trackingRows: [string, string][] = [
    ['주문번호', reference],
    ['배송 건 번호', input.shipmentId],
    ['출고지', input.originName],
    ...(carrierName ? [['택배사', carrierName] as [string, string]] : []),
    ...(trackingNumber ? [['운송장번호', trackingNumber] as [string, string]] : []),
  ];

  const text = textBlock([
    'ICONS 굿즈가 배송을 시작했어요.',
    '',
    `주문번호: ${reference}`,
    `배송 건 번호: ${input.shipmentId}`,
    `출고지: ${input.originName}`,
    ...(carrierName ? [`택배사: ${carrierName}`] : []),
    ...(trackingNumber ? [`운송장번호: ${trackingNumber}`] : []),
    ...(trackingUrl ? [`배송 조회: ${trackingUrl}`] : []),
    ...(hasTracking || input.giftDelivery ? [] : [TRACKING_FALLBACK]),
    '',
    '[이번 배송 굿즈]',
    ...input.items.map(itemLine),
    '',
    '[배송지]',
    ...(input.giftDelivery ? [GIFT_DELIVERY_PRIVATE] : addressLines(input.address)),
    '',
    `주문 상세: ${input.orderUrl}`,
  ]);

  const html = htmlDocument(reference, [
    htmlHeading('굿즈가 배송을 시작했어요'),
    htmlParagraph('아래 굿즈가 배송지로 이동하고 있습니다. 다른 배송 건은 주문 상세에서 확인해주세요.'),
    htmlSectionTitle('배송 정보'),
    htmlDefinitionRows(trackingRows),
    ...(hasTracking || input.giftDelivery ? [] : [htmlParagraph(TRACKING_FALLBACK)]),
    ...(trackingUrl ? [htmlButton(trackingUrl, '배송 조회하기')] : []),
    htmlSectionTitle('이번 배송 굿즈'),
    htmlItemRows(input.items),
    htmlSectionTitle('배송지'),
    input.giftDelivery ? htmlParagraph(GIFT_DELIVERY_PRIVATE) : htmlAddress(input.address),
    htmlButton(input.orderUrl, '주문 상세 보기'),
  ].join(''));

  return { subject, text, html };
}

export interface GiftRecipientEmailInput {
  orderId: string;
  stage: 'confirmation' | 'shipped';
  items: { name: string; variantName?: string | null; qty: number }[];
  address: CheckoutAddress;
  giftUrl: string;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}
/** Recipient messages accept no money, payment, coupon or sender fields. */
export function renderGiftRecipientEmail(input: GiftRecipientEmailInput): RenderedEmail {
  const reference = orderReferenceLabel(input.orderId), shipped = input.stage === 'shipped';
  const title = shipped ? '받을 선물의 배송이 시작됐어요' : '받을 선물이 주문됐어요';
  const itemLines = input.items.map(item => `${item.name}${item.variantName ? ` · ${item.variantName}` : ''} × ${item.qty}`);
  const trackingUrl = shipped ? safeLinkUrl(input.trackingUrl) : null;
  const tracking = shipped ? [input.carrierName ? `택배사: ${input.carrierName}` : '', input.trackingNumber ? `운송장번호: ${input.trackingNumber}` : ''].filter(Boolean) : [];
  const text = textBlock([title, '', '[받을 선물]', ...itemLines, '', '[배송지]', ...addressLines(input.address), ...tracking,
    ...(trackingUrl ? [`배송 조회: ${trackingUrl}`] : []), '', `선물함: ${input.giftUrl}`]);
  const html = htmlDocument(reference, [htmlHeading(title), htmlSectionTitle('받을 선물'), ...itemLines.map(line => htmlParagraph(line, INK)),
    htmlSectionTitle('배송지'), htmlAddress(input.address), ...tracking.map(line => htmlParagraph(line)),
    ...(trackingUrl ? [htmlButton(trackingUrl, '배송 조회하기')] : []), htmlButton(input.giftUrl, '선물함 보기')].join(''), '선물 주문번호');
  return { subject: `[ICONS] ${title}`, text, html };
}

export interface InquiryAnsweredEmailInput {
  /** 문의번호. 운영자와 이용자가 서로 부르는 값이라 uuid가 아니라 순번이다. */
  reference: number;
  categoryLabel: string;
  title: string;
  /** 운영자가 등록한 답변 본문. 줄바꿈은 그대로 살린다. */
  answerBody: string;
  inquiryUrl: string;
}

export interface RestockAlertEmailInput {
  goodName: string;
  /** 옵션 단위 신청이면 그 옵션 이름(PD-11). 굿즈 단위(모든 옵션) 신청은 비운다. */
  optionName?: string | null;
  /**
   * 굿즈 상세로 가는 **절대** URL. 메일에는 우리 사이트의 상대 경로를 이어 붙일
   * 기준 문서가 없어 http(s) 여야 하고, `safeLinkUrl` 이 그 조건을 강제한다.
   */
  goodPath: string;
}

/** 재입고 알림 첫 문장. 알림함 본문(DB 트리거)과 같은 문장이다. */
export function restockAlertSentence(goodName: string, optionName?: string | null): string {
  const option = optionName?.trim();
  return option ? `${goodName} · ${option} 옵션이 다시 판매를 시작했어요.` : `${goodName} 굿즈가 다시 판매를 시작했어요.`;
}

/**
 * 재입고 알림 메일 (#326).
 *
 * 인앱 알림은 goods 트리거가 같은 트랜잭션에서 남긴다. 메일만 밖에서 보낸다 —
 * HTTP 는 트랜잭션에 넣을 수 없고, 메일 실패가 재고 전이를 되돌리면 안 된다.
 *
 * 사실성 게이트가 없다. "다시 판매를 시작했다"는 그 뒤에 또 품절이 나도 그 시점에는
 * 참이었고, 재품절은 재신청이라는 자기 경로를 갖는다.
 */
export function renderRestockAlertEmail(input: RestockAlertEmailInput): RenderedEmail {
  /* 굿즈명·옵션명은 길이 무제한 text 다. claim_email_delivery 가 제목 200자를 넘기면 거부하는데,
     트리거는 이미 notified 로 넘긴 뒤라 그 메일은 영영 못 나간다 — 제목만 자르고
     전체 이름은 본문이 말한다. 옵션 단위 신청은 어느 옵션인지 제목에서도 보인다. */
  const option = input.optionName?.trim();
  const subjectLabel = option ? `${input.goodName} · ${option}` : input.goodName;
  const subjectName = subjectLabel.length > 60
    ? `${subjectLabel.slice(0, 59)}…`
    : subjectLabel;
  const subject = `[ICONS] 재입고 알림 — ${subjectName}`;
  const goodUrl = safeLinkUrl(input.goodPath);
  const sentence = restockAlertSentence(input.goodName, option);

  const text = textBlock([
    sentence,
    '',
    '수량이 한정적이라 다시 품절될 수 있어요.',
    ...(goodUrl ? ['', `굿즈 보러 가기: ${goodUrl}`] : []),
  ]);

  const html = htmlDocument(input.goodName, [
    htmlHeading('재입고 알림'),
    htmlParagraph(sentence, INK),
    htmlParagraph('수량이 한정적이라 다시 품절될 수 있어요.'),
    ...(goodUrl ? [htmlButton(goodUrl, '굿즈 보러 가기')] : []),
  ].join(''), '굿즈');

  return { subject, text, html };
}

/* 답변 본문의 줄바꿈만 살린다. 문단 태그로 감싸지 않는 이유는 운영자가 목록·인사말을
   자유롭게 쓰기 때문이다 — 빈 줄을 문단으로 해석하면 의도한 간격이 사라진다. */
function htmlAnswerBody(body: string) {
  const lines = body
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br />');
  return `<tr><td style="padding:0 24px 12px 24px;font-size:14px;line-height:1.8;color:${INK};">${lines}</td></tr>`;
}

/**
 * 1:1 문의 답변 알림 메일(#253).
 *
 * 답변 본문을 그대로 싣는다. "답변이 등록됐습니다"만 보내고 링크를 누르게 하면
 * 메일함에서 답을 확인할 수 없어 이용자가 같은 질문을 다시 접수한다.
 *
 * 이 메일은 주문 상태에 매이지 않는다 — "답변이 등록됐다"는 사실은 그 뒤에 문의가
 * 종결돼도 계속 참이라 주문 메일 같은 사실성 게이트가 없다.
 */
export function renderInquiryAnsweredEmail(input: InquiryAnsweredEmailInput): RenderedEmail {
  const reference = `#${input.reference}`;
  const subject = `[ICONS] 문의에 답변이 등록됐어요 (문의번호 ${reference})`;

  const text = textBlock([
    'ICONS 1:1 문의에 답변이 등록됐어요.',
    '',
    `문의번호: ${reference}`,
    `문의 유형: ${input.categoryLabel}`,
    `제목: ${input.title}`,
    '',
    '[답변]',
    input.answerBody,
    '',
    '추가로 궁금한 점이 있으면 같은 문의에 이어서 질문할 수 있습니다.',
    '',
    `문의 상세: ${input.inquiryUrl}`,
  ]);

  const html = htmlDocument(reference, [
    htmlHeading('문의에 답변이 등록됐어요'),
    htmlParagraph('보내주신 1:1 문의에 운영자가 답변했습니다.'),
    htmlSectionTitle('문의 정보'),
    htmlDefinitionRows([
      ['문의번호', reference],
      ['문의 유형', input.categoryLabel],
      ['제목', input.title],
    ]),
    htmlSectionTitle('답변'),
    htmlAnswerBody(input.answerBody),
    htmlParagraph('추가로 궁금한 점이 있으면 같은 문의에 이어서 질문할 수 있습니다.'),
    htmlButton(input.inquiryUrl, '문의 상세 보기'),
  ].join(''), '문의번호');

  return { subject, text, html };
}
