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
