import 'server-only';

import { revalidatePath } from 'next/cache';

/** ID와 공개 slug가 다를 수 있으므로 상세는 실제 동적 라우트 패턴으로 갱신한다. */
export function revalidateGoodsSurfaces() {
  for (const path of ['/', '/ip', '/shop', '/shop/new', '/shop/best', '/search', '/cart', '/checkout', '/admin', '/admin/catalog/goods']) {
    revalidatePath(path);
  }
  for (const path of ['/shop/[goodId]', '/ip/[id]', '/events/[eventId]', '/checkout/[orderId]']) {
    revalidatePath(path, 'page');
  }
}

/**
 * 상품 상세 화면만 바꾸는 저장(사이즈·혜택·A/S·제작 정보·출고 설정). 상세 주소는 상품 자동코드라(`/shop/hsq-0059`, ADR-0050)
 * 내부 id 경로(`/shop/<goods.id>`)를 갱신해도 고객이 보는 상세는 갱신되지 않는다 — 상세 라우트 전체를 갱신한다.
 */
export function revalidateGoodDetailSurfaces() {
  revalidatePath('/shop/[goodId]', 'page');
}
