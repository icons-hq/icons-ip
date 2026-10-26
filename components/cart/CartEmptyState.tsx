'use client';

import type { ReactNode } from 'react';
import { useListingReturnHref } from '@/components/shell/ListingReturn';
import { WcButton } from '@/components/wc/WcButton';
import { listingReturnLabel } from '@/lib/listing-return';

/*
 * 빈 장바구니(CT-02) — [일러스트 자리] → 16/400 안내 → 220×60 액센트 CTA.
 * 일러스트는 ICONS 라인아트(LG-7, 사람 작업)가 오면 art 로 넘긴다(146×146, 레퍼런스 실측). 지금은 비워 두고,
 * 없을 때도 안내·CTA만으로 가운데 정렬이 선다. CTA는 직전에 보던 굿즈 목록으로 돌아간다(10/14 S17 셋째 기준,
 * lib/listing-return) — 서버 렌더와 첫 페인트는 굿즈샵이고 하이드레이션 뒤 남겨 둔 목록 주소로 바뀐다. 문구는 목적지 표면을
 * 말한다(굿즈샵·온라인 팝업·검색 결과 둘러보기 — 주문 목록·주문 결제 화면의 둘러보기와 같은 규칙).
 * CTA 묶음(.wc-cart__cta-bar)은 모바일에서 하단 고정 바가 된다(CT-03).
 */
export function CartEmptyState({ art }: { art?: ReactNode }) {
  const href = useListingReturnHref();

  return (
    <div className="wc-cart__empty">
      {art ? <div aria-hidden="true" className="wc-cart__empty-art">{art}</div> : null}
      <p className="wc-cart__empty-message">장바구니가 비어 있어요</p>
      <div className="wc-cart__cta-bar">
        <WcButton className="wc-cart__empty-cta" href={href} variant="accent">{listingReturnLabel(href)}</WcButton>
      </div>
    </div>
  );
}
