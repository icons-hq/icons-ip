/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function fulfillmentError(code?: string, message?: string) {
 const known: Record<string, string> = { fulfillment_changed: '다른 담당자가 설정을 변경했습니다. 최신 설정을 확인해주세요.', digital_asset_unavailable: '파일 확인이 끝나지 않았거나 사용할 수 없는 파일입니다.', digital_supply_conflict: '디지털 파일 상품은 예약판매·주문제작을 해제한 뒤 설정해주세요.', digital_upload_budget: '진행 중인 파일 업로드를 마친 뒤 잠시 후 다시 시도해주세요.', digital_upload_expired: '업로드 준비 시간이 지났습니다. 파일을 다시 선택해주세요.', digital_access_unavailable: '현재 계정과 결제·환불 상태로 파일을 받을 수 없습니다.' };
 return known[message ?? ''] ?? (code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === 'PT409' ? '설정이나 요청 내용이 변경됐습니다. 최신 상태를 확인해주세요.' : code?.startsWith('22') ? '배송 방식·비용·파일·처리 근거를 확인해주세요.' : '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');
}
