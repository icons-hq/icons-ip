/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsSizeChartError(message?: string): string {
  if (message === 'operation_conflict') return '같은 저장 요청의 계정 또는 입력이 달라졌습니다. 현재 저장본을 확인해주세요.';
  if (message === 'goods_size_chart_changed' || message === 'goods_size_template_changed') return '다른 저장 결과가 있습니다. 작성한 표는 유지했습니다. 최신 저장본을 확인해주세요.';
  if (message === 'goods_size_chart_cannot_clear') return '저장된 표를 빈 표로 지울 수 없습니다. 설정안함으로 바꾸면 표를 보존하고 공개 표시를 중지합니다.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return '현재 상품 관리 권한을 확인해주세요.';
  return '사이즈·측정 항목과 모든 치수를 확인해주세요. 치수는 0.1~99,999, 소수 한 자리까지 입력할 수 있습니다.';
}
