import { CATALOG_PERMISSION_MESSAGE, CHANGED_BY_OTHER, SAVE_MISMATCH_MESSAGE } from './goods-template-save';

/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsSizeChartError(message?: string): string {
  if (message === 'operation_conflict') return SAVE_MISMATCH_MESSAGE;
  /* 상품의 사이즈 안내는 [최신 저장본 확인]으로 비교하고, 템플릿 편집 창은 그 자리에서 두 길을 고른다. */
  if (message === 'goods_size_chart_changed') return `${CHANGED_BY_OTHER} 작성한 표는 그대로 있습니다. [최신 저장본 확인]을 눌러 지금 저장된 표와 비교해 주세요.`;
  if (message === 'goods_size_template_changed') return `${CHANGED_BY_OTHER} 작성한 표는 그대로 있습니다.`;
  if (message === 'goods_size_chart_cannot_clear') return '저장된 표를 빈 표로 지울 수 없습니다. 고객 화면 표시를 ‘표시 안 함’으로 바꾸면 표는 그대로 보관하고 고객 화면에서만 숨깁니다.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return CATALOG_PERMISSION_MESSAGE;
  return '사이즈·측정 항목과 모든 치수를 확인해주세요. 치수는 0.1~99,999, 소수 한 자리까지 입력할 수 있습니다.';
}
