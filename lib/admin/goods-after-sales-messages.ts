/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsAfterSalesError(message?: string): string {
  if (message === 'operation_conflict') return '저장 요청의 계정 또는 입력 정보가 달라졌습니다. 저장된 내용을 다시 불러와 확인해주세요.';
  if (message === 'goods_after_sales_changed' || message === 'goods_after_sales_template_changed') return '다른 저장 결과가 있습니다. 입력은 유지했습니다. 저장된 내용을 다시 확인해주세요.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return '현재 상품 관리 권한을 확인해주세요.';
  return '저장하지 못했습니다. 전화번호 20자·A/S 안내 1,300자·판매자 특이사항 1,300자와 현재 권한을 확인해주세요.';
}
