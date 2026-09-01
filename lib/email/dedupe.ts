/* 발송 이력 dedupe_key의 형식 진실원.
 *
 * 재발송 경로는 email_deliveries 행 하나만 들고 "이 메일을 다시 보내라"를 실행해야 한다.
 * 그러려면 행에서 템플릿과 주문 id를 되찾을 수 있어야 하므로, 키를 만드는 쪽과 되읽는 쪽이
 * 같은 규칙을 공유한다. 키 문자열을 호출부마다 손으로 조립하면 한쪽만 바뀌었을 때
 * 재발송이 조용히 끊긴다 — 그 경로를 아예 만들지 않는다. */

export const EMAIL_TEMPLATE_NAMES = [
  'order_confirmation',
  'order_shipped',
  'inquiry_answered',
  'restock_alert',
] as const;

export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

/* 주문 uuid를 키에 담는 템플릿.
 *
 * 재발송 경로는 dedupe_key에서 주문을 되찾아 "이 메일이 지금도 사실인가"를 판정한다.
 * 문의 답변 메일의 키는 메시지 id라 그 판정을 할 근거가 없다 — 형식만 uuid로 같아서
 * 구분하지 않으면 메시지 id를 주문 id로 읽고 엉뚱한 주문을 조회한다.
 * DB 게이트(admin_request_email_resend)도 같은 구분을 한다. 양쪽을 함께 바꾼다. */
export const ORDER_EMAIL_TEMPLATE_NAMES = ['order_confirmation', 'order_shipped'] as const;

export type OrderEmailTemplateName = (typeof ORDER_EMAIL_TEMPLATE_NAMES)[number];

/** DB의 email_deliveries.status check와 같은 집합이다. 양쪽을 함께 바꾼다. */
export const EMAIL_DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;

export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return (EMAIL_TEMPLATE_NAMES as readonly string[]).includes(value);
}

export function isOrderEmailTemplateName(value: string): value is OrderEmailTemplateName {
  return (ORDER_EMAIL_TEMPLATE_NAMES as readonly string[]).includes(value);
}

export function isEmailDeliveryStatus(value: string): value is EmailDeliveryStatus {
  return (EMAIL_DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function orderEmailDedupeKey(template: OrderEmailTemplateName, orderId: string): string {
  return `${template}:${orderId}`;
}

/**
 * 문의 답변 메일의 dedupe_key.
 *
 * 문의 id가 아니라 답변 메시지 id를 담는다. 한 스레드는 여러 번 답변될 수 있고,
 * 문의 id로 키를 만들면 두 번째 답변이 첫 답변의 sent 행에 막혀 조용히 사라진다.
 */
export function inquiryEmailDedupeKey(messageId: string): string {
  return `inquiry_answered:${messageId}`;
}

/**
 * 재입고 알림 메일의 dedupe_key (#326).
 *
 * 신청 id 하나로는 부족하다. 같은 신청 행은 재신청→재품절→재입고 사이클마다
 * pending 으로 되돌아오는데, 키가 그대로면 두 번째 재입고 메일이 첫 사이클의 sent
 * 행에 막혀 조용히 사라진다. 전이 시각(restock_alerts.notified_at)을 함께 담아
 * 사이클마다 유일한 키가 되게 한다 — DB 트리거의 알림함 dedupe_key 와 같은 규율이다.
 */
export function restockAlertEmailDedupeKey(alertId: string, notifiedAtIso: string): string {
  return `restock_alert:${alertId}:${notifiedAtIso}`;
}

/**
 * 주문 메일 dedupe_key를 템플릿·주문 id로 되돌린다.
 *
 * 형식을 벗어난 키는 null이다 — 재발송 대상이 아닌 행(미래에 추가될 다른 템플릿 등)을
 * 주문 메일로 오인해 엉뚱한 주문에 메일을 보내지 않게 한다.
 */
export function parseOrderEmailDedupeKey(
  value: string,
): { template: OrderEmailTemplateName; orderId: string } | null {
  const separator = value.indexOf(':');
  if (separator < 0) return null;

  const template = value.slice(0, separator);
  const orderId = value.slice(separator + 1).toLowerCase();
  if (!isOrderEmailTemplateName(template)) return null;
  if (!UUID_PATTERN.test(orderId)) return null;

  return { template, orderId };
}
