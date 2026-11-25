/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
/** 저장하기 전에 무엇이 안 되는지 따로 말한다(받을 방식을 안 고른 것과 금액이 숫자가 아닌 것은 고치는 곳이 다르다). 저장된 상품의 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다. */
export const FULFILLMENT_METHOD_REQUIRED = '받을 방식을 하나 이상 골라 주세요.';
export const FULFILLMENT_AMOUNT_INVALID = '선결제 배송비와 설치비는 0 이상의 숫자(원)로 적어 주세요.';
/** 저장 결과를 모를 때. 패널의 [저장됐는지 확인]은 같은 작업 번호로 다시 보내므로 두 번 저장되지 않는다. */
export const GOODS_FULFILLMENT_SAVE_UNCERTAIN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
export function fulfillmentError(code?: string, message?: string) {
 const known: Record<string, string> = { fulfillment_changed: '다른 사람이 먼저 바꿨습니다. [현재 배송·제공 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.', transaction_runtime_disabled: '지금은 수령 방식 설정을 저장할 수 없습니다. 운영 설정을 확인해주세요.', digital_asset_unavailable: '파일 확인이 끝나지 않았거나 사용할 수 없는 파일입니다.', digital_supply_conflict: '디지털 파일 상품은 예약판매·주문제작을 해제한 뒤 설정해주세요.', digital_upload_budget: '진행 중인 파일 업로드를 마친 뒤 잠시 후 다시 시도해주세요.', digital_upload_expired: '업로드 준비 시간이 지났습니다. 파일을 다시 선택해주세요.', digital_access_unavailable: '현재 계정과 결제·환불 상태로 파일을 받을 수 없습니다.' };
 return known[message ?? ''] ?? (code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === 'PT409' ? '설정이 그사이 바뀌었습니다. 지금 설정을 다시 불러와 확인해주세요.' : code?.startsWith('22') ? '받을 방식·비용·제공 파일을 확인해주세요.' : '처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
}
