/* 발송 이력 dedupe_key의 형식 진실원.
 *
 * 재발송 경로는 email_deliveries 행 하나만 들고 "이 메일을 다시 보내라"를 실행해야 한다.
 * 그러려면 행에서 템플릿과 주문 id를 되찾을 수 있어야 하므로, 키를 만드는 쪽과 되읽는 쪽이
 * 같은 규칙을 공유한다. 키 문자열을 호출부마다 손으로 조립하면 한쪽만 바뀌었을 때
 * 재발송이 조용히 끊긴다 — 그 경로를 아예 만들지 않는다. */

export const EMAIL_TEMPLATE_NAMES = ['order_confirmation', 'order_shipped'] as const;

export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

/** DB의 email_deliveries.status check와 같은 집합이다. 양쪽을 함께 바꾼다. */
export const EMAIL_DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;

export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return (EMAIL_TEMPLATE_NAMES as readonly string[]).includes(value);
}

export function isEmailDeliveryStatus(value: string): value is EmailDeliveryStatus {
  return (EMAIL_DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function orderEmailDedupeKey(template: EmailTemplateName, orderId: string): string {
  return `${template}:${orderId}`;
}

/**
 * 주문 메일 dedupe_key를 템플릿·주문 id로 되돌린다.
 *
 * 형식을 벗어난 키는 null이다 — 재발송 대상이 아닌 행(미래에 추가될 다른 템플릿 등)을
 * 주문 메일로 오인해 엉뚱한 주문에 메일을 보내지 않게 한다.
 */
export function parseOrderEmailDedupeKey(
  value: string,
): { template: EmailTemplateName; orderId: string } | null {
  const separator = value.indexOf(':');
  if (separator < 0) return null;

  const template = value.slice(0, separator);
  const orderId = value.slice(separator + 1).toLowerCase();
  if (!isEmailTemplateName(template)) return null;
  if (!UUID_PATTERN.test(orderId)) return null;

  return { template, orderId };
}
