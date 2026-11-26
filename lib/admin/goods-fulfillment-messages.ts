/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
/** 저장하기 전에 무엇이 안 되는지 따로 말한다(수령 방식을 안 고른 것과 금액이 숫자가 아닌 것은 고치는 곳이 다르다). 저장된 상품의 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다. */
export const FULFILLMENT_METHOD_REQUIRED = '수령 방식을 하나 이상 골라 주세요.';
export const FULFILLMENT_AMOUNT_INVALID = '선결제 배송비와 설치비는 0 이상의 숫자(원)로 적어 주세요.';
/** 상품 수정 화면의 수령 방식을 고치다 떠날 때 묻는 말(따로 저장하는 영역이라 [수령 방식 저장]을 눌러야 저장된다). */
export const GOODS_FULFILLMENT_LEAVE_MESSAGE = '수령 방식을 고친 뒤 [수령 방식 저장]을 누르지 않았습니다. 이 화면을 떠나면 적은 내용이 사라집니다. 이동할까요?';
/** 저장 결과를 모를 때. 패널의 [저장됐는지 확인]은 같은 작업 번호로 다시 보내므로 두 번 저장되지 않는다. */
export const GOODS_FULFILLMENT_SAVE_UNCERTAIN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
/**
 * 택배 외 수령 방식·설치비·디지털 파일은 쇼핑몰 전체에 걸린 주문 설정이 켜져 있어야 저장된다(꺼져 있으면 DB가 거절한다).
 * 그 설정을 켜는 어드민 화면은 없고 개발 담당자가 켠다 — 그래서 '운영 설정을 확인'이 아니라 누구에게 요청하는지를 말한다.
 * 화면은 상품을 열 때 그 설정을 읽어, 꺼져 있으면 고르기 전에 막는다(화면 규칙 5). 아래 세 문장이 그때 보이는 말이다.
 */
/** 등록 화면: 택배만 고른 처음 상태에서 다른 방식을 고르지 못하게 막을 때. */
export const GOODS_FULFILLMENT_RUNTIME_OFF = '지금 쇼핑몰 설정에서는 택배만 쓸 수 있습니다. 퀵·방문수령·직접배송·화물배송, 설치비, 직접 전달, 디지털 파일은 고를 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.';
/** 등록 화면: 이미 다른 방식이 들어 있을 때(되살린 입력 등). 칸은 열어 두고 무엇을 남겨야 등록되는지 말한다. */
export const GOODS_FULFILLMENT_RUNTIME_OFF_REVERT = '지금 쇼핑몰 설정에서는 택배만 쓸 수 있습니다. 택배만 켜고 설치비 0원, 고객 안내는 비워 두어야 상품이 등록됩니다. 다른 방식을 써야 하면 개발 담당자에게 요청해 주세요.';
/** 저장된 상품: 이 설정이 꺼져 있으면 수령 방식 저장이 모두 거절되므로 영역을 잠근다. */
export const GOODS_FULFILLMENT_RUNTIME_OFF_SAVED = '지금 쇼핑몰 설정에서는 수령 방식을 바꿀 수 없습니다. 퀵·방문수령·설치비·디지털 파일을 써야 하면 개발 담당자에게 요청해 주세요.';
/** 화면이 미리 막지 못한 채 저장이 거절됐을 때(설정을 읽지 못했거나 그사이 꺼진 경우). */
export const GOODS_FULFILLMENT_RUNTIME_REJECTED = '지금 쇼핑몰 설정에서는 수령 방식을 저장할 수 없습니다. 상품을 등록하는 중이면 택배만 켜고 설치비 0원, 고객 안내는 비워 두면 등록됩니다. 다른 방식을 써야 하면 개발 담당자에게 요청해 주세요.';
export function fulfillmentError(code?: string, message?: string) {
 const known: Record<string, string> = { fulfillment_changed: '다른 사람이 먼저 바꿨습니다. [현재 수령 방식 불러오기]를 눌러 지금 수령 방식을 확인한 뒤 다시 저장해주세요.', transaction_runtime_disabled: GOODS_FULFILLMENT_RUNTIME_REJECTED, digital_asset_unavailable: '파일 확인이 끝나지 않았거나 사용할 수 없는 파일입니다.', digital_supply_conflict: '디지털 파일 상품은 예약판매·주문제작을 해제한 뒤 설정해주세요.', digital_upload_budget: '진행 중인 파일 업로드를 마친 뒤 잠시 후 다시 시도해주세요.', digital_upload_expired: '업로드 준비 시간이 지났습니다. 파일을 다시 선택해주세요.', digital_access_unavailable: '현재 계정과 결제·환불 상태로 파일을 받을 수 없습니다.' };
 return known[message ?? ''] ?? (code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === 'PT409' ? '설정이 그사이 바뀌었습니다. 지금 설정을 다시 불러와 확인해주세요.' : code?.startsWith('22') ? '수령 방식·비용·디지털 파일을 확인해주세요.' : '처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
}
