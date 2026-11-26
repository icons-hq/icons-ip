import { parseGoodsBenefitValues, type GoodsBenefitValues } from '@/lib/goods-benefits';
import { CATALOG_PERMISSION_MESSAGE, CHANGED_BY_OTHER, SAVE_FAILED_MESSAGE, SAVE_MISMATCH_MESSAGE } from './goods-template-save';

const LIMITS = { giftText: 100, eventText: 40, images: 3 } as const;
const over = (subject: string, text: string, limit: number) => `${subject} ${(Array.from(text).length - limit).toLocaleString('ko-KR')}자 넘었습니다. ${limit}자까지 적을 수 있습니다.`;

/**
 * 저장하기 전에 무엇이 왜 안 되는지 하나씩 말한다(설명 없음 / 글자 수 / 같은 사진 / 장수). 문제가 없으면 null.
 * 판정은 저장 검사(parseGoodsBenefitValues)와 같다. 빈 사진 칸('')은 세지 않는다.
 */
export function goodsBenefitsProblem(values: GoodsBenefitValues): string | null {
  const paths = values.giftImagePaths.filter(Boolean);
  if (Array.from(values.giftText).length > LIMITS.giftText) return over('사은품 설명이', values.giftText, LIMITS.giftText);
  if (Array.from(values.eventText).length > LIMITS.eventText) return over('이벤트 문구가', values.eventText, LIMITS.eventText);
  if (paths.length > LIMITS.images) return `사은품 사진은 ${LIMITS.images}장까지 넣을 수 있습니다. ${paths.length - LIMITS.images}장을 빼 주세요.`;
  if (new Set(paths).size !== paths.length) return '같은 사진이 두 칸에 들어 있습니다. 한 칸의 사진을 빼거나 다른 사진으로 바꿔 주세요.';
  if (paths.length && !values.giftText.trim()) return '사은품 사진을 넣었으면 사은품 설명도 적어 주세요.';
  return parseGoodsBenefitValues({ ...values, giftImagePaths: paths }) ? null
    : '저장할 수 없는 글자나 사진이 들어 있습니다. 붙여 넣은 글이면 직접 다시 적고, 사진은 다시 올리거나 [사진 보관함에서 고르기]로 골라 주세요.';
}

/** 저장된 내용과 지금 적은 내용이 같은가(다시 불러오기 전에 묻을지 가린다). 빈 사진 칸('')은 세지 않는다. */
export function sameGoodsBenefits(left: GoodsBenefitValues, right: GoodsBenefitValues): boolean {
  const paths = (values: GoodsBenefitValues) => values.giftImagePaths.filter(Boolean).join('\n');
  return left.eventText === right.eventText && left.giftText === right.giftText && paths(left) === paths(right);
}

/** 상품 수정 화면의 사은품·이벤트 안내를 고치다 떠날 때 묻는 말(따로 저장하는 영역이라 [안내 저장]을 눌러야 저장된다). */
export const GOODS_BENEFITS_LEAVE_MESSAGE = '사은품·이벤트 안내를 고친 뒤 [안내 저장]을 누르지 않았습니다. 이 화면을 떠나면 적은 내용이 사라집니다. 이동할까요?';

/** 다른 사은품 칸에 이미 넣은 사진. `index` 칸의 선택창에서 이 사진들은 '선택됨'으로 보여 다시 고를 수 없다(같은 사진은 한 번만 넣는다). */
export function otherGiftImagePaths(values: Pick<GoodsBenefitValues, 'giftImagePaths'>, index: number | null): string[] {
  return values.giftImagePaths.filter((path, position) => Boolean(path) && position !== index);
}

/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsBenefitsError(message?: string): string {
  if (message === 'operation_conflict') return SAVE_MISMATCH_MESSAGE;
  /* 상품의 안내는 저장된 내용을 다시 불러와 고치고, 템플릿 편집 창은 그 자리에서 두 길을 고른다. */
  if (message === 'goods_benefits_changed') return `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다. 필요한 내용을 복사해 둔 뒤 [저장된 내용으로 다시 불러오기]를 누르고 다시 고쳐 주세요.`;
  if (message === 'goods_event_template_changed') return `${CHANGED_BY_OTHER} 적은 문구는 그대로 있습니다.`;
  if (message === 'unverified_artwork') return '등록할 수 있는 사진이 아닙니다. 사진을 다시 올리거나 [사진 보관함에서 고르기]로 골라 주세요.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return CATALOG_PERMISSION_MESSAGE;
  if (message === 'invalid_goods_benefit_content') return '이벤트 문구는 40자, 사은품 설명은 100자, 사은품 사진은 3장까지 넣을 수 있습니다. 넘는 칸을 줄인 뒤 다시 저장해 주세요.';
  if (message === 'invalid_goods_benefit_images') return '사은품 사진을 넣었으면 사은품 설명도 적어 주세요. 같은 사진은 한 번만 넣을 수 있습니다.';
  if (message === 'invalid_goods_event_template') return '이벤트 문구를 1~40자로 적어 주세요.';
  return SAVE_FAILED_MESSAGE;
}

/* 사진 아래 한 줄. 방금 고르거나 올린 사진은 아직 상품에 저장되지 않았다 — '현재 저장된 이미지'라고 말하지 않는다(2026-11-26 브라우저 확인 S16). */
/** 저장된 상품의 사은품 영역: [안내 저장]을 눌러야 저장된다. */
export const GOODS_BENEFIT_PHOTO_UNSAVED_NOTE = '고른 사진 · [안내 저장]을 눌러야 적용됩니다';
/** 등록 화면: 상품과 함께 저장된다. */
export const GOODS_BENEFIT_PHOTO_WITH_GOOD_NOTE = '고른 사진 · 상품과 함께 저장됩니다';
