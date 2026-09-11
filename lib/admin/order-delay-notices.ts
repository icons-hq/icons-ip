export type OrderDelayChannelStatus='prepared'|'queued'|'processing'|'sent'|'failed'|'unknown'|'suppressed';
export interface OrderDelayNoticeTarget {
  id:string;orderId:string;buyerName:string;recipientEmail:string|null;shipmentIds:string[];shipmentLabels:string[];messageBody:string;
  inAppStatus:'prepared'|'sent';emailStatus:OrderDelayChannelStatus;emailProviderState:string|null;errorCode:string|null;retryable:boolean;attempts:number;
}
export interface OrderDelayNotice {
  id:string;title:string;customerBody:string;expectedShipDate:string|null;createdAt:string;expiresAt:string;requestedAt:string|null;emailEnabled:boolean;targets:OrderDelayNoticeTarget[];
}
export interface OrderDelayNoticeSummary {id:string;title:string;createdAt:string;requestedAt:string|null}
export interface PrepareOrderDelayNotice {requestId:string;shipmentIds:string[];title:string;body:string;expectedShipDate:string|null}
export interface OrderDelayNoticeActionResult {notice?:OrderDelayNotice;emailConfigured?:boolean;error?:string}
export const ORDER_DELAY_STATUS_LABELS:Record<OrderDelayChannelStatus,string>={prepared:'미요청',queued:'발송 대기',processing:'처리 중',sent:'발송',failed:'실패',unknown:'결과 불명',suppressed:'발송 제외'};
export const ORDER_DELAY_ERROR_LABELS:Record<string,string>={
  provider_not_configured:'이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.',delivery_disabled:'지연 안내 이메일 발송 설정이 꺼져 있습니다.',
  recipient_missing:'구매자 이메일이 없거나 형식이 올바르지 않습니다.',target_changed:'주문·배송·구매자 또는 예정일이 변경되어 재확인이 필요합니다.',
  delivery_in_progress:'기존 요청 결과를 확인하고 있습니다.',delivery_outcome_unknown:'같은 발송 요청으로 접수 결과를 확인합니다. 새 메시지를 발송하지 마세요.',
  delivery_needs_review:'중복 발송 방지를 위해 자동 처리를 멈췄습니다. 공급자 발송 이력을 확인해주세요.',
  provider_retryable:'이메일 공급자가 요청을 처리하지 못했습니다. 실패 건을 재시도할 수 있습니다.',
  provider_rejected:'이메일 공급자가 발송 실패 또는 반송을 기록했습니다. 수신 상태를 확인해주세요.',provider_suppressed:'이메일 공급자가 해당 수신자 발송을 제외했습니다.',
};
export const ORDER_DELAY_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const optionalString=(value:unknown)=>value===null||typeof value==='string';

/** Fail closed on incomplete server receipts; a request is never called successful from a boolean alone. */
export function parseOrderDelayNotice(value:unknown):OrderDelayNotice|null {
  if(!object(value)||typeof value.id!=='string'||!ORDER_DELAY_UUID.test(value.id)||typeof value.title!=='string'||typeof value.customerBody!=='string'
    ||!optionalString(value.expectedShipDate)||typeof value.createdAt!=='string'||typeof value.expiresAt!=='string'||!optionalString(value.requestedAt)
    ||typeof value.emailEnabled!=='boolean'||!Array.isArray(value.targets)||value.targets.length<1||value.targets.length>100)return null;
  if(!value.targets.every((target:unknown)=>object(target)&&typeof target.id==='string'&&ORDER_DELAY_UUID.test(target.id)
    &&typeof target.orderId==='string'&&ORDER_DELAY_UUID.test(target.orderId)&&typeof target.buyerName==='string'&&optionalString(target.recipientEmail)
    &&Array.isArray(target.shipmentIds)&&target.shipmentIds.length>0&&target.shipmentIds.every((id:unknown)=>typeof id==='string'&&ORDER_DELAY_UUID.test(id))
    &&Array.isArray(target.shipmentLabels)&&target.shipmentLabels.every((label:unknown)=>typeof label==='string')&&typeof target.messageBody==='string'
    &&['prepared','sent'].includes(String(target.inAppStatus))&&Object.hasOwn(ORDER_DELAY_STATUS_LABELS,String(target.emailStatus))
    &&optionalString(target.emailProviderState)&&optionalString(target.errorCode)&&typeof target.retryable==='boolean'&&Number.isInteger(target.attempts)))return null;
  return value as unknown as OrderDelayNotice;
}

export function orderDelayNoticeError(code:string):string {
  const errors:Record<string,string>={
    delay_notice_stale:'미리보기 이후 주문·배송·구매자 또는 지연 정보가 바뀌었습니다. 목록에서 다시 선택해 새 미리보기를 만들어주세요.',
    delay_notice_ineligible:'현재 지연 중인 미발송 배송 건만 선택할 수 있습니다. 취소·클레임 상태도 확인해주세요.',
    delay_notice_expired:'미리보기 유효 시간이 지났습니다. 새 미리보기를 만들어주세요.',
    delay_notice_not_found:'안내 기록을 찾을 수 없습니다.',delay_notice_idempotency_conflict:'같은 요청의 내용이 변경되었습니다. 새 미리보기를 만들어주세요.',
    delay_notice_delivery_disabled:ORDER_DELAY_ERROR_LABELS.delivery_disabled,
    invalid_delay_notice:'배송 건과 고객 문구·예정일을 확인해주세요.',
  };
  return errors[code]??'처리 결과를 확인하지 못했습니다. 같은 안내의 결과를 새로고침한 뒤 다시 시도해주세요.';
}
