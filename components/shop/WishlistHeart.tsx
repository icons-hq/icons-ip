'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toggleWishlistAction } from '@/app/shop/actions';

export interface WishlistHeartProps {
  goodId: string;
  initialWished: boolean;
  /** 어드민 미리보기처럼 실제로 저장하면 안 되는 자리에서 쓴다. */
  disabled?: boolean;
  className?: string;
}

/*
 * 위시 하트 (#326 S4).
 *
 * 낙관적으로 먼저 뒤집고 서버 결과로 확정한다 — 왕복을 기다리면 목록에서 여러 개를
 * 연달아 누를 때 하트가 뒤늦게 켜져 어느 굿즈를 눌렀는지 알 수 없다. 실패하면 누르기
 * 전 상태로 되돌린다.
 *
 * 게스트는 저장할 곳이 없으므로 로그인으로 보낸다. next 는 지금 보고 있는 경로다 —
 * 로그인 뒤 목록 맨 위로 돌아오면 방금 무엇을 찜하려 했는지 사라진다.
 */
export function WishlistHeart({ className, disabled, goodId, initialWished }: WishlistHeartProps) {
  const [wished, setWished] = useState(initialWished);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();

  function toggle() {
    const nextWished = !wished;
    setWished(nextWished);

    startTransition(async () => {
      const result = await toggleWishlistAction(goodId, nextWished);
      if (result.ok) return;

      setWished(!nextWished);
      if (result.error === 'auth_required') {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });
  }

  return (
    <button
      aria-label={wished ? '위시리스트에서 빼기' : '위시리스트에 담기'}
      aria-pressed={wished}
      className={`wc-wish-heart${wished ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || pending}
      onClick={toggle}
      type="button"
    >
      {/* 하트는 상태를 색으로만 전한다 — 접근 이름과 aria-pressed 가 같은 사실을 말한다. */}
      <svg aria-hidden height="18" viewBox="0 0 24 24" width="18">
        <path
          d="M12 20.5 4.2 13a4.9 4.9 0 0 1 0-6.9 4.9 4.9 0 0 1 6.9 0l.9.9.9-.9a4.9 4.9 0 0 1 6.9 0 4.9 4.9 0 0 1 0 6.9Z"
          fill={wished ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    </button>
  );
}
