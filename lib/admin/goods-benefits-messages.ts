import { CATALOG_PERMISSION_MESSAGE, CHANGED_BY_OTHER, SAVE_FAILED_MESSAGE, SAVE_MISMATCH_MESSAGE } from './goods-template-save';

/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsBenefitsError(message?: string): string {
  if (message === 'operation_conflict') return SAVE_MISMATCH_MESSAGE;
  /* 상품의 안내는 저장된 내용을 다시 불러와 고치고, 템플릿 편집 창은 그 자리에서 두 길을 고른다. */
  if (message === 'goods_benefits_changed') return `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다. 필요한 내용을 따로 적어 둔 뒤 [저장된 내용으로 다시 불러오기]를 누르고 다시 고쳐 주세요.`;
  if (message === 'goods_event_template_changed') return `${CHANGED_BY_OTHER} 적은 문구는 그대로 있습니다.`;
  if (message === 'unverified_artwork') return '등록 가능한 사진이 아닙니다. 사진을 다시 업로드하거나 사진 보관함에서 선택해주세요.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return CATALOG_PERMISSION_MESSAGE;
  if (message === 'invalid_goods_benefit_content') return '이벤트 문구는 40자, 사은품 설명은 100자, 사은품 사진은 3장까지 넣을 수 있습니다. 넘는 칸을 줄인 뒤 다시 저장해 주세요.';
  if (message === 'invalid_goods_benefit_images') return '사은품 사진을 넣었으면 사은품 설명도 적어 주세요. 같은 사진은 한 번만 넣을 수 있습니다.';
  if (message === 'invalid_goods_event_template') return '이벤트 문구를 1~40자로 적어 주세요.';
  return SAVE_FAILED_MESSAGE;
}
