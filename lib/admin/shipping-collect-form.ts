import type { AdminConfirmRequest } from '@/lib/admin/confirm';
import {
  SHIPPING_COLLECT_STATE_LABEL, SHIPPING_COLLECT_WRITE_EVENTS,
  type ShippingCollectEvent, type ShippingCollectObligation, type ShippingCollectWriteEvent,
} from '@/lib/admin/shipping-collect-events';
import { krwAmountWords } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';

/*
 * 주문 상세의 착불 수납 기록(components/admin/ShippingCollectPanel)이 쓰는 판단과 문구.
 * 최종 판정은 DB(admin_record_shipping_collect_event)가 한다. 여기는 그 조건을 화면이 미리 알아 금액을 채우고, 고를 수 없는 종류를 이유와 함께 잠그고,
 * 기록하기 전에 확인창에 대상·금액·되돌릴 수 없다는 사실을 말하는 데만 쓴다. DB 규칙: 수납 확인·환불 확인 필요·전액 환불은 주문 당시 착불 금액과 같은 금액,
 * 미수납 종료는 0원, 정정은 바로 앞 기록과 같은 금액, 금액 불일치는 예정 금액과 다른 금액이다.
 */

/** 기록 종류의 화면 이름. 바로 앞 기록을 되돌리는 정정은 '바로 앞 기록 정정'이다. */
export function shippingCollectEventLabel(event: ShippingCollectEvent['event']): string {
  return event === 'correction' ? '바로 앞 기록 정정' : SHIPPING_COLLECT_STATE_LABEL[event];
}

/** 기록 한 건을 읽는 한 줄(종류 · 금액 · 발생 시각). 내부 번호 대신 정정 대상을 가리킬 때 쓴다. */
export function shippingCollectEventSummary(event: Pick<ShippingCollectEvent, 'event' | 'amount' | 'occurredAt' | 'recordedAt'>): string {
  return `${shippingCollectEventLabel(event.event)} · ${krwAmountWords(event.amount)} · ${formatOrderDateTime(event.occurredAt ?? event.recordedAt)}`;
}

/** 기록 종류가 금액을 정해 두면 그 금액, 운영자가 적어야 하면(수납 금액 불일치) 또는 아직 종류를 안 골랐으면 null. */
export function shippingCollectFixedAmount(event: string, obligation: Pick<ShippingCollectObligation, 'amount'>, latest: Pick<ShippingCollectEvent, 'amount'> | undefined): number | null {
  if (event === 'collected' || event === 'refund_review' || event === 'refunded') return obligation.amount;
  if (event === 'void') return 0;
  if (event === 'correction') return latest ? latest.amount : null;
  return null;
}

/** 정해진 금액이 왜 그 금액인지 한 줄(금액 옆에 보인다). */
export function shippingCollectFixedAmountNote(event: string): string {
  return event === 'void' ? '미수납으로 끝내므로 0원입니다.' : event === 'correction' ? '바로 앞 기록과 같은 금액입니다.' : '주문 당시 착불 금액입니다.';
}

/**
 * 지금 이 종류를 기록할 수 없는 이유(없으면 null). 서버가 거절하는 조건 가운데 화면이 이미 아는 것만 본다 —
 * 착불 기록의 상태·이력과, 주문 상태를 알려 주면 그것. 주문 상태를 모르면(orderStatus 없음) 주문 상태 조건은 서버에 맡긴다.
 */
export function shippingCollectKindLock(event: ShippingCollectWriteEvent, obligation: Pick<ShippingCollectObligation, 'state' | 'events'>, orderStatus?: string): string | null {
  const notCanceled = orderStatus !== undefined && orderStatus !== 'canceled';
  if (event === 'collected') {
    if (orderStatus === 'pending') return '결제가 확인된 뒤에 고를 수 있습니다.';
    return ['planned', 'mismatch', 'refund_review'].includes(obligation.state) ? null : '이미 외부 수납을 확인했습니다.';
  }
  if (event === 'void') {
    if (notCanceled) return '주문이 취소된 뒤에 고를 수 있습니다.';
    const collected = obligation.events.some(row => row.event === 'collected'
      && !obligation.events.some(other => other.event === 'correction' && other.reversesOperationId === row.operationId));
    return obligation.state === 'collected' || collected ? '수납을 확인한 기록이 있어 미수납으로 끝낼 수 없습니다.' : null;
  }
  if (event === 'refunded') {
    if (notCanceled) return '주문이 취소된 뒤에 고를 수 있습니다.';
    return ['collected', 'refund_review', 'mismatch'].includes(obligation.state) ? null : '수납을 확인한 뒤에 고를 수 있습니다.';
  }
  return null;
}

/**
 * 기록 종류 선택지. 끝난 기록(미수납 종료·외부 전액 환불 확인)에는 정정만 남고, 정정은 바로 앞 기록이 수납 예정·정정이 아닐 때만 있다.
 * 고를 수 없는 종류는 목록에서 빼지 않고 이유와 함께 잠가 둔다.
 */
export function shippingCollectKindOptions(obligation: Pick<ShippingCollectObligation, 'state' | 'events'>, orderStatus?: string): { event: ShippingCollectWriteEvent; label: string; lock: string | null }[] {
  const latest = obligation.events.at(-1);
  const terminal = obligation.state === 'void' || obligation.state === 'refunded';
  return SHIPPING_COLLECT_WRITE_EVENTS
    .filter(event => event === 'correction' ? Boolean(latest && latest.event !== 'planned' && latest.event !== 'correction') : !terminal)
    .map(event => ({ event, label: shippingCollectEventLabel(event), lock: shippingCollectKindLock(event, obligation, orderStatus) }));
}

/** 금액을 보내기 전에 알 수 있는 어긋남. 수납 금액 불일치는 예정 금액과 달라야 한다. */
export function shippingCollectAmountProblem(event: string, amount: number, obligation: Pick<ShippingCollectObligation, 'amount'>): string | null {
  return event === 'mismatch' && amount === obligation.amount ? `수납 금액 불일치는 예정 금액(${krwAmountWords(obligation.amount)})과 다른 금액이어야 합니다.` : null;
}

/**
 * [기록하기]의 확인창. 착불 수납 기록은 쌓이기만 하고 지울 수 없어, 무엇을 얼마로 기록하는지와 되돌리는 길을 말한다.
 * 이 기록은 외부(운송사) 수납을 적는 것이라 온라인 결제·환불 금액은 바뀌지 않는다(저장 뒤 안내와 같은 사실).
 */
export function shippingCollectConfirmRequest({ obligation, event, amount, latest }: {
  obligation: Pick<ShippingCollectObligation, 'originName' | 'amount'>;
  event: ShippingCollectWriteEvent; amount: number; latest: Pick<ShippingCollectEvent, 'event' | 'amount' | 'occurredAt' | 'recordedAt'> | undefined;
}): AdminConfirmRequest {
  const target = `${obligation.originName} · 착불 배송비 ${krwAmountWords(obligation.amount)}`;
  const outside = '온라인 결제·환불 금액은 바뀌지 않습니다.';
  if (event === 'correction') {
    return {
      title: '바로 앞 기록을 정정할까요?',
      message: `${target}\n바로 앞 기록${latest ? `(${shippingCollectEventSummary(latest)})` : ''}을 없던 것으로 되돌립니다. 맞는 내용은 되돌린 뒤 새로 기록해야 합니다.\n${outside}`,
      confirmLabel: '정정하기', cancelLabel: '돌아가기',
    };
  }
  return {
    title: '착불 수납을 기록할까요?',
    message: `${target}\n기록 종류: ${shippingCollectEventLabel(event)}\n금액: ${krwAmountWords(amount)}\n기록은 지울 수 없습니다. 잘못 적었다면 기록 종류에서 ‘바로 앞 기록 정정’을 골라 되돌린 뒤 다시 기록하세요.\n${outside}`,
    confirmLabel: '기록하기', cancelLabel: '돌아가기',
  };
}

/**
 * 서버가 돌려준 안내에 옛 버튼 이름이 있으면 지금 화면의 이름으로 바꿔 보인다. 서버 액션의 문구(app/admin/shipping-collect-event-actions.ts)가 아직
 * [이전 결과 확인 후 같은 요청 재시도]·[이전 결과 확인]·[이전 요청 무효 처리 후 다시 입력]을 말해도, 화면에는 그 이름의 버튼이 없기 때문이다.
 * 서버 문구가 새 이름으로 바뀌면 아무 일도 하지 않는다.
 */
export function shippingCollectServerMessage(message: string): string {
  /* 조사도 새 이름에 맞춘다(재시도를 → 확인을, 다시 입력을 → 다시 하기를). */
  return message
    .replace(/\[이전 결과 확인 후 같은 요청 재시도\](를|을)?/g, (_, particle) => `[저장됐는지 확인]${particle ? '을' : ''}`)
    .replace(/\[이전 결과 확인\](를|을)?/g, (_, particle) => `[저장됐는지 확인]${particle ? '을' : ''}`)
    .replace(/\[이전 요청 무효 처리 후 다시 입력\](을|를)?/g, (_, particle) => `[그만두고 다시 하기]${particle ? '를' : ''}`);
}

/** 지금 시각의 KST datetime-local 값(분 단위). 발생 시각 칸의 처음 값이다 — 대부분 확인한 자리에서 바로 기록한다. */
export const shippingCollectNowLocal = (now: Date = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
