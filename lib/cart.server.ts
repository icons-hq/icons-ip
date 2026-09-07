import 'server-only';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeCartItems } from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';

interface CartRow {
  good_id: string;
  qty: number;
}

/*
 * 로그인한 사람의 저장된 장바구니에 담긴 상품 id.
 *
 * 서버가 미리 담아 보낼 수 있는 것은 여기까지다 — 비회원 장바구니는 브라우저에만 있고,
 * 로그인 사용자도 이 화면을 여는 사이에 다른 탭에서 더 담을 수 있다. 모자란 것은 화면이
 * 열린 뒤 채운다(`useCartCatalog`).
 *
 * 실패는 빈 목록으로 수렴한다 — 미리 받기가 안 됐다고 장바구니를 못 여는 것이 더 나쁘고,
 * 화면이 어차피 같은 id 를 다시 묻는다.
 */
export async function loadCartGoodIds(): Promise<string[]> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return [];
  if (!isOnboarded(auth.profile, auth.user.email)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('cart_items')
      .select('good_id,qty')
      .eq('user_id', auth.user.id)
      .order('created_at');
    if (error) return [];

    return normalizeCartItems(((data ?? []) as CartRow[]).map((row) => ({
      goodId: row.good_id,
      qty: row.qty,
    }))).map((item) => item.goodId);
  } catch {
    return [];
  }
}
