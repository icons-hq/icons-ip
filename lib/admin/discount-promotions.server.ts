import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  DISCOUNT_PROMOTION_LIST_PAGE_SIZE,
  parseDiscountPromotionDetail,
  parseDiscountPromotionList,
  parseDiscountPromotionTargetOptions,
  type DiscountPromotionDetail,
  type DiscountPromotionList,
  type DiscountPromotionTargetOptions,
} from './discount-promotions';

/** 할인 프로모션 목록(최근 등록 순). 기획전으로 거르면 그 기획전을 대상으로 만든 프로모션만 본다. */
export async function loadDiscountPromotionList(filters: { campaign: string | null; page: number }): Promise<DiscountPromotionList> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_discount_promotions', {
    p_campaign: filters.campaign, p_limit: DISCOUNT_PROMOTION_LIST_PAGE_SIZE, p_offset: (filters.page - 1) * DISCOUNT_PROMOTION_LIST_PAGE_SIZE,
  });
  const parsed = error ? null : parseDiscountPromotionList(data);
  if (!parsed) throw new Error('할인 프로모션 목록을 불러오지 못했습니다.');
  return parsed;
}

/** 없는 프로모션은 null(화면이 404로 보낸다). 그 밖의 실패는 오류다. */
export async function loadDiscountPromotion(id: string): Promise<DiscountPromotionDetail | null> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_discount_promotion', { p_id: id });
  if (error?.message === 'discount_promotion_not_found') return null;
  const parsed = error ? null : parseDiscountPromotionDetail(data);
  if (!parsed) throw new Error('할인 프로모션을 불러오지 못했습니다.');
  return parsed;
}

export async function loadDiscountPromotionTargetOptions(): Promise<DiscountPromotionTargetOptions> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_discount_promotion_target_options');
  const parsed = error ? null : parseDiscountPromotionTargetOptions(data);
  if (!parsed) throw new Error('프로모션 대상 목록을 불러오지 못했습니다.');
  return parsed;
}
