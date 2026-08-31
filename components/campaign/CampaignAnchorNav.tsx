'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CampaignAnchor } from '@/lib/campaigns';

/* 캠페인 상세 sticky 앵커 내브 (R-06 §2.2 · DESIGN §6 campaign-landing).
 *
 * 높이 48, 상단 고정. 좌측은 본문 섹션 앵커, 우측은 코인 박스다 — 잔액은 상시
 * 노출하고, 게스트에게는 같은 자리에 로그인 링크가 온다.
 *
 * 활성 섹션 표시만 클라이언트에서 한다. 스크롤 위치를 직접 재면 프레임마다 계산이
 * 돌아 저사양 기기에서 스크롤이 끊긴다 — IntersectionObserver 가 브라우저 몫으로
 * 넘겨 준다. 그 밖의 연출(부드러운 이동·강조 애니메이션)은 넣지 않는다(DESIGN §12). */

export interface CampaignAnchorNavProps {
  anchors: CampaignAnchor[];
  /** 로그인 상태의 코인 잔액. 게스트는 null. */
  balance: number | null;
  loginHref: string;
  signedIn: boolean;
}

export function CampaignAnchorNav({ anchors, balance, loginHref, signedIn }: CampaignAnchorNavProps) {
  const [activeId, setActiveId] = useState<string | null>(anchors[0]?.id ?? null);
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!anchors.length || typeof IntersectionObserver === 'undefined') return;

    const elements = anchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;

    const visible = visibleRef.current;
    visible.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        /* 여러 섹션이 동시에 보일 때는 문서 순서상 가장 앞선 것을 활성으로 둔다 —
           "지금 읽고 있는 곳"은 화면 위쪽이다. */
        const first = anchors.find((anchor) => visible.has(anchor.id));
        if (first) setActiveId(first.id);
      },
      /* 상단 48px은 이 내브 자신이 덮는다. 아래 55%를 잘라 내면 화면 상단 근처에
         들어온 섹션만 활성 후보가 된다. */
      { rootMargin: '-56px 0px -55% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [anchors]);

  return (
    <nav aria-label="캠페인 목차" className="wc-campaign-nav">
      <div className="wc-campaign-nav__inner">
        {anchors.length ? (
          <ul className="wc-campaign-nav__list">
            {anchors.map((anchor) => (
              <li key={anchor.id}>
                <a
                  aria-current={anchor.id === activeId ? 'true' : undefined}
                  className={`wc-campaign-nav__link${anchor.id === activeId ? ' is-active' : ''}`}
                  href={`#${anchor.id}`}
                >
                  {anchor.label}
                </a>
              </li>
            ))}
          </ul>
        ) : <span className="wc-campaign-nav__list" />}
        {signedIn ? (
          <p className="wc-campaign-nav__coin">
            코인 <strong>{(balance ?? 0).toLocaleString('ko-KR')}</strong>
          </p>
        ) : (
          <Link className="wc-campaign-nav__coin wc-campaign-nav__coin--guest" href={loginHref}>
            로그인하고 코인 확인
          </Link>
        )}
      </div>
    </nav>
  );
}
