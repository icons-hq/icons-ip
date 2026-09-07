'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveCartCatalogAction } from '@/app/cart/catalog-actions';
import type { CartItem } from '@/lib/cart';
import {
  buildCartLines,
  mergeCartCatalog,
  missingCartGoodIds,
  type CartCatalog,
  type CartLineBase,
} from '@/lib/cart-catalog';

export interface CartCatalogState {
  lines: CartLineBase[];
  /** 아직 답을 못 받은 줄이 있다. **화면은 이걸 「품절」이 아니라 「로딩」으로 그려야 한다.** */
  resolving: boolean;
}

/*
 * 담긴 상품만 받아 오는 조회 (규모 후속).
 *
 * 서버가 미리 담아 준 것(로그인 사용자의 저장된 장바구니)에서 시작하고, 모자란 id 가
 * 생기면 그때 묻는다 — 비회원 장바구니는 브라우저에만 있고, 다른 탭에서 담은 것도 있다.
 *
 * `resolving` 을 따로 내보내는 이유: 없는 상품과 **아직 안 받은** 상품이 화면에서는 똑같이
 * 「없는 줄」로 보인다. 둘을 섞으면 로딩 중에 결제 버튼이 잠기고 사용자는 품절로 읽는다.
 *
 * `answered` 는 **물어봤고 답을 받은** id 다(서버가 미리 물어본 것 포함). 없는 상품은 답이
 * 비어 오므로 이 표시가 없으면 영원히 「모자란 id」로 남아 같은 질문을 반복한다.
 */
export function useCartCatalog(initial: CartCatalog, items: readonly CartItem[]): CartCatalogState {
  const [catalog, setCatalog] = useState<CartCatalog>(initial);
  const [answered, setAnswered] = useState<readonly string[]>(initial.answeredIds ?? []);
  /* 렌더 중에 읽지 않는다 — 같은 질문이 두 번 나가는 것만 막는 효과 안쪽 장치다. */
  const inFlight = useRef<Set<string>>(new Set());

  const missing = useMemo(() => {
    const answeredSet = new Set(answered);
    return missingCartGoodIds(items, catalog.goods).filter((id) => !answeredSet.has(id));
  }, [items, catalog.goods, answered]);
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!missingKey) return;

    const ids = missingKey.split(',').filter((id) => !inFlight.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) inFlight.current.add(id);

    let cancelled = false;
    void resolveCartCatalogAction(ids).then((incoming) => {
      for (const id of ids) inFlight.current.delete(id);
      if (cancelled) return;
      setCatalog((current) => mergeCartCatalog(current, incoming));
      setAnswered((current) => [...new Set([...current, ...ids])]);
    });

    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  const lines = useMemo(() => buildCartLines(items, catalog), [items, catalog]);

  return { lines, resolving: missing.length > 0 };
}
