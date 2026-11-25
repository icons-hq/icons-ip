import { parseGoodsAfterSalesValues, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { CATALOG_PERMISSION_MESSAGE, CHANGED_BY_OTHER, SAVE_FAILED_MESSAGE, SAVE_MISMATCH_MESSAGE } from './goods-template-save';

const LIMITS = { phone: 20, guide: 1300, sellerSpecialNotes: 1300 } as const;
const length = (text: string) => Array.from(text.trim()).length;
/** `subject`는 조사까지 붙인 칸 이름이다(예: 'A/S 안내가'). */
const over = (subject: string, text: string, limit: number) => `${subject} ${(length(text) - limit).toLocaleString('ko-KR')}자 넘었습니다. ${limit.toLocaleString('ko-KR')}자까지 적을 수 있습니다.`;

/** 저장하기 전에 어느 칸이 왜 안 되는지 말한다. 문제가 없으면 null. 판정은 저장 검사(parseGoodsAfterSalesValues)와 같다. */
export function goodsAfterSalesProblem(values: GoodsAfterSalesValues): string | null {
  if (!values.phone.trim()) return 'A/S 전화번호를 적어 주세요.';
  if (length(values.phone) > LIMITS.phone) return over('A/S 전화번호가', values.phone, LIMITS.phone);
  if (!values.guide.trim()) return 'A/S 안내를 적어 주세요.';
  if (length(values.guide) > LIMITS.guide) return over('A/S 안내가', values.guide, LIMITS.guide);
  if (length(values.sellerSpecialNotes) > LIMITS.sellerSpecialNotes) return over('판매자 특이사항이', values.sellerSpecialNotes, LIMITS.sellerSpecialNotes);
  return parseGoodsAfterSalesValues(values) ? null : '저장할 수 없는 글자가 들어 있습니다. 다른 곳에서 붙여 넣은 글이면 그 부분을 직접 다시 적어 주세요.';
}

/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function goodsAfterSalesError(message?: string): string {
  if (message === 'operation_conflict') return SAVE_MISMATCH_MESSAGE;
  /* 상품의 안내는 저장된 내용을 다시 불러와 고치고, 템플릿 편집 창은 그 자리에서 두 길을 고른다. */
  if (message === 'goods_after_sales_changed') return `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다. 필요한 내용을 따로 적어 둔 뒤 [저장된 내용으로 다시 불러오기]를 누르고 다시 고쳐 주세요.`;
  if (message === 'goods_after_sales_template_changed') return `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다.`;
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return CATALOG_PERMISSION_MESSAGE;
  if (message === 'invalid_goods_after_sales') return 'A/S 전화번호는 20자, A/S 안내와 판매자 특이사항은 1,300자까지 적을 수 있습니다. A/S 전화번호와 A/S 안내는 꼭 적어 주세요.';
  return SAVE_FAILED_MESSAGE;
}
