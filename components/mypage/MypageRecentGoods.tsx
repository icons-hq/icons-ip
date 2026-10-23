'use client';

import { useEffect, useState } from 'react';
import { loadInterestCollectionAction } from '@/app/shop/experience-actions';
import { ProductCard } from '@/components/wc/ProductCard';
import type { Good } from '@/lib/data';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { readRecentGoods, recentGoodsKey } from '@/lib/product-detail-experiences';
import { hrefFor } from '@/lib/routes';
import { MypageSectionHead } from './MypageSectionHead';

/** 대시보드에 보이는 최근 본 굿즈 수 — 레퍼런스 대시보드 블록과 같은 다섯 칸(11 §5.2 ④). */
export const RECENT_GOODS_DASHBOARD_LIMIT = 5;

type RecentState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; goods: Good[] };

/*
 * 대시보드 '최근 본 굿즈' (LFS 패리티 2차 L6 · MY-12, 12 LD-16).
 *
 * 기록은 굿즈 상세의 관심 굿즈 선반(ProductInterestShelf)이 계정별 localStorage 에 남긴다 — 그 기록과
 * 저장 고지는 상세 경험 `interests` 스위치에 묶여 있으므로 이 블록도 같은 스위치를 따른다:
 * 서버가 스위치를 꺼 두면 페이지가 블록 자체를 그리지 않고(enabled=false), 켜져 있어도 굿즈를 읽는 액션이
 * 스위치를 다시 확인해 꺼졌다고 답하면 숨는다. 이 블록은 기록을 읽기만 하고 새로 쓰지 않는다.
 * 다른 회원의 기록을 보이지 않도록 서버가 판정한 뷰어 ID 로 저장 키를 고르고, 액션이 돌려준 주인과 맞을 때만 그린다.
 */
export function MypageRecentGoods({ enabled, viewerId }: { enabled: boolean; viewerId: string }) {
  const [state, setState] = useState<RecentState>({ kind: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let recent: string[] = [];
    try {
      recent = readRecentGoods(window.localStorage.getItem(recentGoodsKey(viewerId)));
    } catch {
      /* 저장소가 막힌 브라우저(사생활 보호 모드)는 기록이 없는 것과 같다. */
    }
    void loadInterestCollectionAction(recent, []).then(
      (result) => {
        if (!active) return;
        if (result.ownerId !== viewerId || !result.enabled) {
          setState({ kind: result.unavailable ? 'unavailable' : 'hidden' });
          return;
        }
        setState({ kind: 'ready', goods: result.groups.recent });
      },
      () => {
        if (active) setState({ kind: 'unavailable' });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, viewerId]);

  if (!enabled || state.kind === 'hidden') return null;

  const goods = state.kind === 'ready' ? state.goods.slice(0, RECENT_GOODS_DASHBOARD_LIMIT) : [];
  return (
    <section aria-labelledby="mydash-recent" className="wc-mydash__section">
      <MypageSectionHead
        count={state.kind === 'ready' ? goods.length : undefined}
        href={state.kind === 'ready' && goods.length ? hrefFor('interests') : undefined}
        id="mydash-recent"
        title="최근 본 굿즈"
      />
      {state.kind === 'loading' ? (
        <p aria-live="polite" className="wc-mydash__empty">최근 본 굿즈를 불러오는 중이에요.</p>
      ) : state.kind === 'unavailable' ? (
        <p className="wc-mydash__empty" role="status">최근 본 굿즈를 확인하지 못했어요. 잠시 후 다시 열어주세요.</p>
      ) : goods.length ? (
        <ul className="wc-mydash__shelf">
          {goods.map((good) => (
            <li key={good.id}>
              <ProductCard
                badges={goodDisplayBadges(good)}
                compareAtPrice={good.compareAtPrice}
                href={`/shop/${good.id}`}
                imageBackground={good.img}
                listSurface="standard"
                listingAppearance={good.listingAppearance}
                name={good.name}
                price={good.price}
                priceMax={good.priceMax}
                salePeriod={good.salePeriod}
                showDiscountRate={good.showDiscountRate}
                soldOut={good.stock === 'soldout' || good.stockQty <= 0}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="wc-mydash__empty">최근 본 굿즈가 없어요. 굿즈를 둘러보면 여기에 모여요.</p>
      )}
    </section>
  );
}
