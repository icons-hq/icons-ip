import type { AdminGoodFormValue } from './catalog';
import { goodsLinkedMetadataRpcFields } from './goods-linked-metadata';
import { goodsSalePolicyRpcFields } from './goods-sale-policy';

/** Shared persistence contract after each input has resolved omission versus explicit clearing. */
export function goodSaveFields(value: AdminGoodFormValue) {
  return {
    ...goodsSalePolicyRpcFields(value),
    ...goodsLinkedMetadataRpcFields(value),
    ...(value.claimPolicy ? { claim_policy: value.claimPolicy } : {}),
    id: value.id,
    previous_id: value.previousId,
    code: value.code,
    ip_id: value.ipId,
    name: value.name,
    ...(value.nameEn !== undefined ? { name_en: value.nameEn } : {}),
    ...(value.searchKeywords !== undefined ? { search_keywords: value.searchKeywords } : {}),
    ...(value.displayOrder !== undefined ? { display_order: value.displayOrder } : {}),
    price: value.price,
    compare_at_price: value.compareAtPrice,
    ...(value.showDiscountRate !== undefined ? { show_discount_rate: value.showDiscountRate } : {}),
    badge: value.badge,
    stock: value.stock,
    bg: value.bg,
    image_path: value.imagePath,
    // 긴 상세 이미지 목록과 첫 장 거울(옛 한 장 칸). DB 저장 층이 둘이 같은지 확인한다(20261119170100).
    detail_image_path: value.detailImagePaths[0] ?? null,
    detail_image_paths: value.detailImagePaths,
    gallery_paths: value.galleryPaths,
    description: value.description,
    ...(value.descriptionFormat ? {
      description_format: value.descriptionFormat,
      description_image_paths: value.descriptionImagePaths ?? [],
    } : {}),
    notice_maker: value.notice.maker,
    notice_origin: value.notice.origin,
    notice_material: value.notice.material,
    notice_size: value.notice.size,
    notice_made_on: value.notice.madeOn,
    notice_as_manager: value.notice.asManager,
    notice_as_contact: value.notice.asContact,
    publish: value.publish,
  };
}
