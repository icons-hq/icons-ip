'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { currentListingReturnHref } from '@/components/shell/ListingReturn';
import { Icon } from '@/components/ui/Icon';
import { goBackFromCart, type CartBackEnv, type ProbeWindow } from './cart-back';

/*
 * 모바일 카트 서브헤더(CT-03 · R-05 §1 2026-10 보강) — [← 이전] 제목 [홈]. 990px 이상에서는 CSS가 감추고 전역 헤더가 그대로다.
 * 이 막대가 있는 동안 모바일 전역 헤더(로고 행·GNB 탭)는 숨는다(wc-catalog.css 카트 구간). 셸이 아니라 화면(#root) 안에
 * 두는 이유는 모달이 열리면 본문과 함께 inert 가 되게 하려는 것이다(useOverlayA11y 는 #root 를 덮는다).
 * 제목은 화면의 h1 과 같은 말이라 보조기기에는 감추고, h1 은 모바일에서 시각만 숨긴다.
 */
export function CartSubheader() {
  const router = useRouter();

  /* 앞에 돌아갈 ICONS 화면이 있을 때만 뒤로 간다. 새 탭·주소 직접 입력·탭의 첫 기록으로 돌아온 장바구니는
     직전에 보던 굿즈 목록(없으면 굿즈샵)으로 보낸다(cart-back.ts). */
  const goBack = () => {
    goBackFromCart(window as unknown as CartBackEnv & ProbeWindow, () => router.back(), () => router.push(currentListingReturnHref()));
  };

  return (
    <nav aria-label="장바구니 상단 메뉴" className="wc-cart-subheader">
      <button aria-label="이전 페이지" className="wc-cart-subheader__btn wc-cart-subheader__back" onClick={goBack} type="button">
        <Icon name="arrow" size={24} />
      </button>
      <p aria-hidden="true" className="wc-cart-subheader__title">장바구니</p>
      <Link aria-label="홈" className="wc-cart-subheader__btn" href="/">
        <Icon name="home" size={24} />
      </Link>
    </nav>
  );
}
