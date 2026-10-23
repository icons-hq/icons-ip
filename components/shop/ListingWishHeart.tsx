'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, useTransition } from 'react';
import { toggleWishlistAction } from '@/app/shop/actions';
import {
  confirmWish,
  confirmedWish,
  forgetWishConfirmations,
  subscribeWishConfirmations,
} from './wishlist-heart-store';

export interface ListingWishHeartProps {
  goodId: string;
  /** 목록 페이지가 한 번 내려준 위시 ID 집합에 이 굿즈가 있는지(`lib/listing-wishlist`). */
  initialWished: boolean;
  /** 서버가 로그인 회원으로 판정했는지. false 면 누르는 순간 로그인으로 보낸다. */
  signedIn: boolean;
  /** 굿즈 이름. 목록에는 하트가 여러 개라 접근 이름에 이름이 없으면 어느 굿즈인지 알 수 없다. */
  label: string;
  className?: string;
}

/* 로그인 뒤 같은 목록·같은 필터로 돌아오게 지금 보던 경로와 쿼리를 그대로 싣는다.
   목적지 검증(열린 리디렉션 차단)은 로그인 화면의 next 정규화가 맡는다(#590). */
function loginHref() {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

/*
 * 목록 하트 (LFS 패리티 2차 L4 · CL-01·HM-03, 12 LD-4) — 상품 카드 action 슬롯과 홈 리스트 행의
 * 공용 부품이다. 마이 위시 그리드(L6)가 같은 부품을 그대로 쓴다.
 *
 * 낙관적으로 먼저 뒤집고, 서버가 확인하면 세션 저장소에 적고, 실패하면 누르기 전 상태로
 * 되돌린다. router.refresh() 는 부르지 않는다 — 하트 하나 때문에 목록 전체를 다시 받으면
 * 스크롤·VIEW MORE 로 펼친 상태가 흔들린다. 같은 굿즈의 다른 하트와 뒤로 가기는 저장소가 맞춘다.
 *
 * 게스트는 저장할 곳이 없으므로(위시리스트는 로그인 회원 개념 — CONTEXT.md) 로그인 벽으로 보낸다.
 * 서버가 회원이라고 판정했어도 세션이 그 사이 끝났으면 액션의 auth_required 가 같은 벽으로 보낸다.
 *
 * 카드 링크 밖에 놓인다(ProductCard 의 action 슬롯은 이미지 링크의 형제다) — 링크 안의 버튼은
 * 마크업으로도 잘못됐고 클릭 한 번이 상세 이동까지 같이 일으킨다.
 */
export function ListingWishHeart({ className, goodId, initialWished, label, signedIn }: ListingWishHeartProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const confirmed = useSyncExternalStore(
    subscribeWishConfirmations,
    () => confirmedWish(goodId),
    () => undefined,
  );
  const wished = signedIn && (optimistic ?? confirmed ?? initialWished);

  function toggle() {
    if (pending) return;
    if (!signedIn) {
      forgetWishConfirmations();
      router.push(loginHref());
      return;
    }

    const nextWished = !wished;
    setOptimistic(nextWished);
    startTransition(async () => {
      const result = await toggleWishlistAction(goodId, nextWished).catch(() => null);
      if (result?.ok) confirmWish(goodId, nextWished);
      setOptimistic(null);
      if (result && !result.ok && result.error === 'auth_required') {
        forgetWishConfirmations();
        router.push(loginHref());
      }
    });
  }

  return (
    <button
      aria-busy={pending || undefined}
      aria-label={wished ? `${label} 위시리스트에서 빼기` : `${label} 위시리스트에 담기`}
      aria-pressed={wished}
      className={`wc-list-heart${wished ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={toggle}
      type="button"
    >
      {/* 44px 히트 영역 안에 36px 원을 그린다(레퍼런스 카드 하트 36 · DESIGN §10 아이콘 44).
          하트는 상태를 채움으로만 전한다 — 접근 이름과 aria-pressed 가 같은 사실을 말한다. */}
      <span aria-hidden className="wc-list-heart__disc">
        <svg aria-hidden focusable="false" height="18" viewBox="0 0 24 24" width="18">
          <path
            d="M12 20.5 4.2 13a4.9 4.9 0 0 1 0-6.9 4.9 4.9 0 0 1 6.9 0l.9.9.9-.9a4.9 4.9 0 0 1 6.9 0 4.9 4.9 0 0 1 0 6.9Z"
            fill={wished ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      </span>
    </button>
  );
}
