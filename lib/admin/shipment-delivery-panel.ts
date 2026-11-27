import type { AdminConfirmRequest } from '@/lib/admin/confirm';
import { objectParticle, resultParticle, topicParticle } from '@/lib/korean-particle';
import {
  DELIVERY_METHOD_LABELS, deliveryErrorMessage, deliveryIsHandoff,
  type AdminDeliveryPolicy, type AdminShipmentDelivery, type DeliveryHistory, type DeliveryMethod, type DeliveryOperation,
} from '@/lib/shipment-delivery';

/*
 * 주문 상세의 배송 방식·인계 확인(components/admin/ShipmentDeliveryPanel)이 쓰는 판단과 문구.
 * 최종 판정은 서버가 한다(admin_read_shipment_delivery·admin_select_shipment_delivery_method·admin_record_shipment_delivery).
 * 여기는 화면이 누르기 전에 못 하는 것을 이유와 함께 잠그고, 고를 수 있는 것만 보이고, 확인창에 고객 쪽 결과를 말하는 데만 쓴다.
 * 말은 발송관리의 [방식 바꾸기]·[택배 외 발송처리](ShipmentConsoleDeliveryDialog)와 같다: '배송 방식', 인계한 담당자·배송 업체·기사·업체 연락처·인계 시각·인계 확인 내용.
 */

/** 주문 뒤에 택배에서 바꿀 수 있는 택배 외 방식. 배송없음·디지털은 주문 때 정한 대로 둔다. */
export const SWITCHABLE_DELIVERY_METHODS = ['quick', 'pickup', 'direct', 'freight'] as const;

/** 이력 한 줄의 이름. 인계와 수령을 같은 말로 부른다. */
export const DELIVERY_RECORD_LABELS: Record<string, string> = {
  method_selected: '배송 방식 변경', quick_handoff: '퀵 인계', quick_receive: '퀵 수령 완료', pickup_receive: '방문수령 완료', direct_handoff: '직접배송 인계',
  direct_receive: '직접배송 수령 완료', freight_handoff: '화물배송 인계', freight_receive: '화물배송 수령 완료', none_receive: '직접전달 완료',
  digital_access: '디지털 파일 제공 시작', forced_delivered: '강제 배송완료',
};

/**
 * 지금 배송 방식을 바꿀 수 없는 이유(서버의 canSelect가 거짓일 때). 서버가 막는 조건 가운데 화면이 아는 것을 순서대로 본다 —
 * 배송없음·디지털, 이미 발송, 출고지시를 보낸 뒤, 결제 확인 전, 그 밖(진행 중인 취소·반품·교환 요청이나 등록된 운송장).
 */
export function deliveryChangeBlockReason(shipment: Pick<AdminShipmentDelivery, 'status' | 'exportedAt' | 'orderStatus' | 'summary'>): string {
  const { method, customerMethod } = shipment.summary;
  if (method === 'none' || method === 'digital' || customerMethod === 'none' || customerMethod === 'digital') return '배송없음·디지털 상품은 주문 때 정한 방식을 바꿀 수 없습니다.';
  if (shipment.status === 'canceled') return '취소된 배송 건은 방식을 바꿀 수 없습니다.';
  if (shipment.status !== 'ready') return '이미 발송했거나 배송이 끝난 배송 건은 방식을 바꿀 수 없습니다.';
  if (shipment.exportedAt) return '출고지시를 이미 보낸 배송 건은 방식을 바꿀 수 없습니다.';
  if (!['paid', 'confirmed', 'shipping'].includes(shipment.orderStatus)) return '결제가 확인된 주문만 방식을 바꿀 수 있습니다.';
  return '취소·반품·교환 요청이 진행 중이거나 운송장이 이미 등록된 배송 건은 방식을 바꿀 수 없습니다.';
}

/** 이 출고지에서 쓰고 있는(켜진) 운영 조건. 같은 방식에 여럿이면 가장 새 것을 쓴다. */
export function activeDeliveryPolicy(shipment: Pick<AdminShipmentDelivery, 'policies'>, method: DeliveryMethod): AdminDeliveryPolicy | null {
  return shipment.policies.filter(policy => policy.state === 'active' && policy.method === method).sort((a, b) => b.revision - a.revision)[0] ?? null;
}

/**
 * 고를 수 있는 배송 방식과, 이 출고지에서 켜져 있지 않아 목록에서 뺀 방식. 택배는 운영 조건이 필요 없어 늘 고를 수 있고,
 * 택배 외 방식은 켜진 운영 조건이 있어야 한다(화면 규칙 2 — 고를 수 없는 것은 목록에 넣지 않고 뺐다고 알린다).
 */
export function deliveryMethodChoices(shipment: Pick<AdminShipmentDelivery, 'policies'>): { methods: DeliveryMethod[]; excluded: DeliveryMethod[] } {
  const usable = SWITCHABLE_DELIVERY_METHODS.filter(method => activeDeliveryPolicy(shipment, method));
  return { methods: ['parcel', ...usable], excluded: SWITCHABLE_DELIVERY_METHODS.filter(method => !usable.includes(method)) };
}

/** 목록에서 뺀 방식을 알리는 한 줄(없으면 null). */
export function deliveryExcludedNote(excluded: readonly DeliveryMethod[]): string | null {
  if (!excluded.length) return null;
  const names = excluded.map(method => DELIVERY_METHOD_LABELS[method]).join('·');
  return `${names}${topicParticle(names)} 이 출고지에서 켜져 있지 않아 목록에서 뺐습니다. 배송정보 관리에서 켤 수 있습니다.`;
}

/** 인계·수령을 기록할 수 없는 이유(서버의 canTransition이 거짓이고 기록할 일이 남아 있을 때만). 이미 끝났거나 기록 대상이 아닌 방식이면 null. */
export function deliveryRecordBlockReason(shipment: Pick<AdminShipmentDelivery, 'canTransition' | 'status' | 'orderStatus' | 'summary'>): string | null {
  const { method } = shipment.summary;
  if (shipment.canTransition || !['quick', 'direct', 'freight', 'pickup', 'none'].includes(method)) return null;
  if (shipment.status === 'delivered' || shipment.status === 'canceled') return null;
  if ((method === 'pickup' || method === 'none') && shipment.status !== 'ready') return null;
  if (!['confirmed', 'shipping'].includes(shipment.orderStatus)) return '발주확인 뒤에 인계·수령을 기록할 수 있습니다.';
  return '취소·반품·교환 요청이 진행 중이어서 지금은 기록할 수 없습니다.';
}

/** 지금 보이는 모습이 한 줄이면 충분한가. 택배(또는 배송없음·디지털)이고 변경 이력도 기록할 일도 없으면 접힌 한 줄로 둔다. */
export function deliveryPanelIsCompact(shipment: Pick<AdminShipmentDelivery, 'canTransition' | 'history' | 'summary'>): boolean {
  const { method } = shipment.summary;
  return !shipment.canTransition && shipment.history.length === 0 && (method === 'parcel' || method === 'digital' || method === 'none');
}

/**
 * 인계·수령 기록 양식의 말(칸 이름·예시 글·안내). 주문 상세의 배송 방식·인계 확인(ShipmentDeliveryPanel의 HandoffForm)과
 * 발송관리 줄의 '인계·수령 확인' 창(DispatchDeliveryRecordPanel — 주문 상세를 열 수 없는 출고 전용 계정이 쓰는 길)이 같은 말을 쓴다.
 * 서버 오류 문구(lib/shipment-delivery의 deliveryErrorMessage)가 가리키는 칸 이름도 여기 이름이다.
 */
export const DELIVERY_RECORD_FORM_COPY = {
  providerName: '배송 업체·기사', providerNamePlaceholder: '고객 주문 화면에 보입니다',
  providerPhone: '업체 연락처',
  handoffReference: '인계 확인 내용', handoffReferencePlaceholder: '예: 퀵 접수번호 12345, 기사에게 직접 전달',
  recipientKind: '수령인 구분', recipientUnchosen: '수령인을 확인해주세요', recipientSelf: '구매자 본인', recipientDelegate: '허용된 대리수령인',
  receiptReference: '수령 확인 내용', receiptReferencePlaceholder: '예: 방문한 고객 본인에게 현장에서 전달',
  receiptCode: '고객이 보여 준 확인값',
  receiptCodeNote: '고객이 주문 화면에서 발급한 값입니다(10분 동안 유효). 5번 틀리거나 다시 발급하면 이전 값은 쓸 수 없습니다.',
  preorderBlocked: '예약 품목의 입고 확인이 아직 끝나지 않았습니다. 상품 편집의 예약판매에서 이 주문을 골라 [선택한 예약 주문 입고 확인]을 먼저 눌러주세요.',
  uncertain: '저장됐는지 확인하지 못했습니다. 같은 내용으로 다시 누르면 두 번 저장되지 않습니다.',
  pending: '기록 중…',
} as const;

/** 인계·수령 기록 서버 액션의 결과 문구. 주문 상세(shipment-delivery-actions)와 발송관리 창(dispatch-delivery-actions)이 같은 말을 돌려준다. */
export const DELIVERY_RECORD_RESULT_COPY = {
  invalid: '담당자·시각·확인 내용을 모두 적어주세요. 수령 기록에는 고객이 보여 준 확인값 12자리도 필요합니다.',
  replayed: '이미 저장된 인계·수령 기록입니다.',
  handoff: '인계를 기록하고 배송중으로 바꿨습니다.',
  receive: '수령을 기록하고 배송완료로 바꿨습니다.',
  unread: '인계·수령 정보를 불러오지 못했습니다.',
  unpicked: '배송 건을 다시 골라주세요.',
} as const;

type DeliveryRecordError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * DB가 '시각이 범위를 벗어났다'고 거절했는가. DB(admin_record_shipment_delivery)는 칸이 비었거나 형식이 틀린 것과 시각이 범위 밖인 것을
 * 같은 이름(invalid_delivery_evidence)으로 돌려주되 오류 종류가 다르다 — 값·형식은 22023, 시각 범위(발주확인 전·인계 전·지금보다 뒤)는 23514다.
 */
export function deliveryTimeRejected(error: DeliveryRecordError): boolean {
  return error?.message === 'invalid_delivery_evidence' && error.code === '23514';
}

/**
 * 인계·수령 기록이 거절됐을 때의 문구. 원인을 한 문장에 뭉뚱그리지 않고 오류 종류별로 고칠 칸을 말한다.
 * 칸 이름은 이 양식의 이름(DELIVERY_RECORD_FORM_COPY·deliveryRecordFormCopy)이다. 그 밖의 거절은 공용 문구표를 따른다.
 */
export function deliveryRecordErrorMessage(kind: unknown, error: DeliveryRecordError): string {
  if (error?.message !== 'invalid_delivery_evidence') return deliveryErrorMessage(error?.message ?? undefined);
  const handoff = deliveryIsHandoff(kind);
  if (error.code === '23514') {
    if (handoff) return '인계 시각이 발주확인보다 앞이거나 지금보다 뒤입니다. 발주확인 뒤부터 지금까지의 시각으로 고쳐 주세요.';
    /* 퀵·직접배송·화물배송의 수령은 인계 뒤여야 하고, 방문수령·직접전달은 발주확인 뒤여야 한다. */
    return typeof kind === 'string' && (kind.startsWith('pickup_') || kind.startsWith('none_'))
      ? '수령 시각이 발주확인보다 앞이거나 지금보다 뒤입니다. 발주확인 뒤부터 지금까지의 시각으로 고쳐 주세요.'
      : '수령 시각이 인계 시각보다 앞이거나 지금보다 뒤입니다. 인계 뒤부터 지금까지의 시각으로 고쳐 주세요.';
  }
  /* 값·형식 거절: 빈 칸이거나 길이를 넘었다(담당자·업체 이름 100자, 연락처 40자, 확인 내용 2,000자). 수령은 확인값 12자리도 본다. */
  return handoff
    ? `인계한 담당자·${DELIVERY_RECORD_FORM_COPY.providerName}·${DELIVERY_RECORD_FORM_COPY.providerPhone}·${DELIVERY_RECORD_FORM_COPY.handoffReference}을 모두 적어주세요. 담당자와 업체 이름은 100자, 연락처는 40자, 확인 내용은 2,000자까지입니다.`
    : `수령을 확인한 담당자·${DELIVERY_RECORD_FORM_COPY.recipientKind}·${DELIVERY_RECORD_FORM_COPY.receiptReference}을 모두 적고, ${DELIVERY_RECORD_FORM_COPY.receiptCode} 12자리를 넣어주세요. 담당자 이름은 100자, 확인 내용은 2,000자까지입니다.`;
}

/**
 * 적은 시각이 '지금 분'이면 초까지 채운 지금 시각을 돌려준다(아니면 null). 시각 칸은 분 단위라 초가 00으로 들어오는데, 발주확인(예: 16:00:48)한
 * 그 분 안에 기록하면 16:00:00이 발주확인보다 앞이 되어 DB가 거절한다 — 그 분을 적은 것은 '지금'이라는 뜻이므로, 거절됐을 때 이 값으로
 * 한 번 더 기록한다. DB 시계보다 뒤가 되지 않게 1초 앞당기되 그 분의 시작보다 앞으로 가지는 않는다.
 */
export function deliveryOccurredThisMinute(occurredAt: unknown, now: Date = new Date()): string | null {
  const entered = typeof occurredAt === 'string' ? Date.parse(occurredAt) : Number.NaN;
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000;
  if (!Number.isFinite(entered) || entered !== minuteStart) return null;
  return new Date(Math.max(minuteStart, now.getTime() - 1_000)).toISOString();
}

/** 인계와 수령에 따라 달라지는 말: 양식 제목, 담당자 칸, 시각 칸, 버튼 이름. */
export function deliveryRecordFormCopy(kind: DeliveryOperation) {
  const handoff = deliveryIsHandoff(kind);
  return {
    heading: `${DELIVERY_RECORD_LABELS[kind]} 기록`,
    legend: handoff ? '인계 기록' : '수령 기록',
    operator: handoff ? '인계한 담당자' : '수령을 확인한 담당자',
    operatorPlaceholder: handoff ? '물건을 넘긴 우리 담당자' : '수령을 확인한 우리 담당자',
    occurredAt: `${handoff ? '인계' : '수령'} 시각 (KST)`,
    submit: handoff ? '인계 기록 · 발송처리' : '수령 기록 · 배송완료',
  };
}

/** [발송처리]·[배송완료로 기록]의 확인창. 고객 주문 화면에 바로 보이고 앱 알림이 가며, 배송완료는 청약철회·거래확정 기한이 시작된다. */
export function deliveryRecordConfirmRequest({ kind, reference, originName, providerName }: {
  kind: DeliveryOperation; reference: string; originName?: string; providerName?: string;
}): AdminConfirmRequest {
  const label = DELIVERY_RECORD_LABELS[kind];
  const target = `${originName ? `${originName} · ` : ''}배송 건 ${reference}`;
  if (deliveryIsHandoff(kind)) {
    return {
      title: `${label}${objectParticle(label)} 기록하고 발송처리할까요?`,
      message: `${target}\n배송중으로 바뀌고, 고객 주문 화면에 배송 업체${providerName ? `(${providerName})` : ''}가 바로 보입니다. 주문이 처음 배송중이 되면 고객에게 앱 알림이 갑니다.`,
      confirmLabel: '발송처리', cancelLabel: '돌아가기',
    };
  }
  return {
    title: `${label}${resultParticle(label)} 기록할까요?`,
    message: `${target}\n배송완료로 바뀝니다. 청약철회·거래확정 기한은 입력한 수령 시각부터 셉니다. 주문의 모든 배송 건이 배송완료가 되면 고객에게 앱 알림이 갑니다.`,
    confirmLabel: '배송완료로 기록', cancelLabel: '돌아가기',
  };
}

/** 이력 한 건의 머리말 — '택배 → 퀵 · 고객 요청'처럼 무엇이 어떻게 바뀌었는지(방식 변경만). */
export function deliveryMethodChangeSummary(evidence: Record<string, unknown>): string | null {
  const name = (value: unknown) => typeof value === 'string' && Object.hasOwn(DELIVERY_METHOD_LABELS, value) ? DELIVERY_METHOD_LABELS[value as DeliveryMethod] : null;
  const from = name(evidence.fromMethod), to = name(evidence.toMethod);
  const who = evidence.source === 'dispatch_console' ? '판매자가 바꿈' : typeof evidence.customerRequestReference === 'string' ? '고객 요청' : null;
  return [from && to ? `${from} → ${to}` : null, who].filter(Boolean).join(' · ') || null;
}

/** 이력 한 건에서 보일 값. 인계와 수령은 같은 열을 달리 부른다. 시각은 화면이 KST로 고쳐 보인다. */
export function deliveryHistoryRows(kind: DeliveryHistory['kind'], evidence: Record<string, unknown>): { label: string; value: string; time?: boolean }[] {
  const operator = deliveryIsHandoff(kind) ? '인계한 담당자' : kind.endsWith('_receive') ? '수령을 확인한 담당자' : '처리한 담당자';
  const fields: [string, string][] = [
    ['customerRequestReference', '고객이 요청한 내용'], ['feeConsentReference', '배송비 유지 동의 내용'], ['operatorName', operator],
    ['providerName', '배송 업체·기사'], ['providerPhone', '업체 연락처'], ['handoffReference', '인계 확인 내용'], ['receiptReference', '수령 확인 내용'],
    ['dispatchReason', '바꾼 이유'], ['reason', '강제 배송완료 사유'],
  ];
  const rows: { label: string; value: string; time?: boolean }[] = [];
  for (const [key, label] of fields) if (typeof evidence[key] === 'string') rows.push({ label, value: evidence[key] as string });
  if (typeof evidence.occurredAt === 'string') rows.push({ label: kind === 'forced_delivered' ? '강제 배송완료 시각' : deliveryIsHandoff(kind) ? '인계 시각' : '수령 시각', value: evidence.occurredAt, time: true });
  return rows;
}

/** 지금 시각의 KST datetime-local 값(분 단위). 인계·수령 시각 칸의 처음 값이다 — 대부분 넘긴 자리에서 바로 기록한다. */
export const deliveryNowLocal = (now: Date = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
