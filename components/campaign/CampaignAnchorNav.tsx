'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CampaignAnchor } from '@/lib/campaigns';
import {
  activeCampaignAnchorId,
  campaignAnchorLine,
  campaignAnchorRootMargin,
  campaignAnchorScrollTop,
  campaignAnchorSettle,
  isPlainPrimaryClick,
  parseChromeHeight,
  type CampaignAnchorLanding,
} from './campaign-anchor-scroll';

/* 캠페인 상세 sticky 앵커 내브 (R-06 §2.2 · DESIGN §6 campaign-landing).
 *
 * 높이 48, 상단 고정. 좌측은 본문 섹션 앵커, 우측은 코인 박스다 — 잔액은 상시
 * 노출하고, 게스트에게는 같은 자리에 로그인 링크가 온다.
 *
 * 목차 이동과 활성 표시는 같은 착지선(고정 크롬 높이 + 이 내브 높이)을 쓴다 — 계산은
 * campaign-anchor-scroll 에 있다. 브라우저 기본 해시 이동도 같은 선에 선다(전역 html scroll-padding-top =
 * 고정 크롬, 섹션 scroll-margin-top = 내브 49). 그래도 목차 이동은 직접 옮긴다: 누른 앵커가 활성으로 남을
 * 착지 자리를 알아야 하고(문서 끝에 막힌 섹션), 동작 줄이기 설정의 즉시 이동이 데스크톱 헤더 접힘만큼
 * 어긋나는 것을 멈춘 뒤 바로잡는다. 기본 이동이 하던 나머지 — 주소 해시·방문 기록·이어 읽을 자리(포커스) —
 * 는 그대로 남긴다.
 *
 * 활성 표시는 스크롤 위치를 프레임마다 재지 않는다 — 저사양 기기에서 스크롤이 끊긴다.
 * IntersectionObserver 가 섹션 경계가 착지선을 넘을 때만 다시 재게 한다. 이동은 기본 해시 이동의
 * 부드러운 이동을 그대로 잇고(동작 줄이기 설정이면 즉시), 그 밖의 연출(강조 애니메이션)은 넣지
 * 않는다(DESIGN §12). */

/** 마지막 scroll 이벤트 뒤 이만큼 조용하면 이동이 멈춘 것으로 본다. */
const SETTLE_QUIET_MS = 150;
/** 사용자가 이어서 스크롤하는 등으로 조용해지지 않아도 이 뒤에는 판정을 닫는다. */
const SETTLE_MAX_MS = 2500;

export interface CampaignAnchorNavProps {
  anchors: CampaignAnchor[];
  /** 로그인 상태의 코인 잔액. 게스트는 null. */
  balance: number | null;
  loginHref: string;
  signedIn: boolean;
}

function readAnchorLine(nav: HTMLElement): number {
  const style = window.getComputedStyle(nav);
  return campaignAnchorLine(
    parseChromeHeight(style.getPropertyValue('--wc-sticky-chrome-h'), style.top),
    nav.offsetHeight,
  );
}

function maxScrollY(): number {
  return document.documentElement.scrollHeight - window.innerHeight;
}

/** scroll 이벤트가 SETTLE_QUIET_MS 동안 없으면 onSettle 을 한 번 부른다. 돌려준 함수로 취소한다. */
function watchScrollSettle(onSettle: () => void): () => void {
  let done = false;
  let quiet = 0;
  let cap = 0;
  const onScroll = () => {
    window.clearTimeout(quiet);
    quiet = window.setTimeout(finish, SETTLE_QUIET_MS);
  };
  const cancel = () => {
    done = true;
    window.clearTimeout(quiet);
    window.clearTimeout(cap);
    window.removeEventListener('scroll', onScroll);
  };
  const finish = () => {
    if (done) return;
    cancel();
    onSettle();
  };
  quiet = window.setTimeout(finish, SETTLE_QUIET_MS);
  cap = window.setTimeout(finish, SETTLE_MAX_MS);
  window.addEventListener('scroll', onScroll, { passive: true });
  return cancel;
}

export function CampaignAnchorNav({ anchors, balance, loginHref, signedIn }: CampaignAnchorNavProps) {
  const [activeId, setActiveId] = useState<string | null>(anchors[0]?.id ?? null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !anchors.length) return;
    const sections = anchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!sections.length) return;

    /* 목차로 이동해 멈춘 자리 — 그 자리에 머무는 동안은 누른 앵커가 활성이다. */
    let landing: CampaignAnchorLanding | null = null;
    let cancelSettle: (() => void) | null = null;

    const sync = () => {
      const next = activeCampaignAnchorId(
        sections.map((section) => ({ id: section.id, top: section.getBoundingClientRect().top })),
        readAnchorLine(nav),
        landing,
        window.scrollY,
      );
      if (landing && next !== landing.id) landing = null;
      setActiveId(next);
    };

    /** from: 'nav' 는 목차 클릭, 'history' 는 뒤로·앞으로 가기로 주소의 해시가 바뀐 경우다. */
    const jump = (section: HTMLElement, from: 'nav' | 'history') => {
      cancelSettle?.();
      landing = null;
      const line = readAnchorLine(nav);
      const top = campaignAnchorScrollTop({
        scrollY: window.scrollY,
        sectionTop: section.getBoundingClientRect().top,
        line,
        maxScrollY: maxScrollY(),
      });

      /* 기본 해시 이동이 하던 일은 남긴다: 주소의 해시와 방문 기록(같은 해시면 기록을 늘리지
         않는다), 키보드·보조기기 사용자가 이어 읽을 자리(섹션 제목). 화면은 여기서 옮기므로 preventScroll. */
      if (from === 'nav') {
        if (window.location.hash !== `#${section.id}`) window.history.pushState(null, '', `#${section.id}`);
        section.querySelector<HTMLElement>('.wc-campaign-section__heading')?.focus({ preventScroll: true });
      }

      if (top !== null) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top, behavior: reduceMotion ? 'instant' : 'smooth' });
      }

      /* 멈춘 뒤 한 번 더 잰다 — 이동 중 데스크톱 헤더가 접히거나 펴진 만큼의 어긋남만 바로잡고,
         문서 끝에 막혀 선까지 못 올라온 섹션도 누른 앵커를 활성으로 둔다. */
      cancelSettle = watchScrollSettle(() => {
        cancelSettle = null;
        const settledLine = readAnchorLine(nav);
        const settle = campaignAnchorSettle({
          scrollY: window.scrollY,
          sectionTop: section.getBoundingClientRect().top,
          line: settledLine,
          maxScrollY: maxScrollY(),
          lineShift: settledLine - line,
        });
        if (settle.type === 'realign') window.scrollTo({ top: settle.top, behavior: 'instant' });
        landing = settle.type === 'left' ? null : { id: section.id, scrollY: window.scrollY };
        sync();
      });
    };

    const onClick = (event: MouseEvent) => {
      if (!isPlainPrimaryClick(event)) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
      const section = link ? sections.find((candidate) => link.getAttribute('href') === `#${candidate.id}`) : undefined;
      if (!section) return;
      event.preventDefault();
      jump(section, 'nav');
    };
    nav.addEventListener('click', onClick);

    /* 목차가 남긴 기록을 뒤로·앞으로 오가면 브라우저가 해시로 직접 다시 옮긴다(Chrome 은 저장된 자리 대신
       해시 위치로 부드럽게 이동한다 — 2026-10-22 실측). 같은 착지선으로 목차 이동처럼 옮겨, 누른 앵커의 착지
       자리와 즉시 이동의 헤더 접힘 보정을 함께 챙긴다. hashchange 는 그 이동이 화면에 그려지기 전에 와서
       이동 하나로 보인다. */
    const onHashChange = () => {
      /* 섹션 id 는 ASCII(campaign-section-N)라 해시를 디코드하지 않고 그대로 맞춘다 — 깨진 퍼센트 인코딩에도 던지지 않는다. */
      const section = sections.find((candidate) => window.location.hash === `#${candidate.id}`);
      if (section) jump(section, 'history');
    };
    window.addEventListener('hashchange', onHashChange);

    let observer: IntersectionObserver | null = null;
    let observedLine = Number.NaN;
    const observe = () => {
      observer?.disconnect();
      observedLine = readAnchorLine(nav);
      observer = new IntersectionObserver(() => {
        /* 크롬 높이가 바뀌어 선이 옮겨 갔으면 띠를 다시 건다 — 새 관찰의 첫 콜백이 다시 잰다. */
        if (readAnchorLine(nav) !== observedLine) observe();
        else sync();
      }, { rootMargin: campaignAnchorRootMargin(observedLine), threshold: 0 });
      /* 앞 형제의 바닥이 곧 앵커 섹션의 머리다 — 둘 다 보아야 머리가 선을 넘는 순간을 놓치지 않는다
         (사이에 앵커 없는 블록이 끼어도 마찬가지). */
      for (const section of sections) {
        observer.observe(section);
        if (section.previousElementSibling) observer.observe(section.previousElementSibling);
      }
    };

    /* 내브의 sticky top 이 움직이면(데스크톱 헤더 펼침·접힘, 990px 경계) 착지선도 옮겨 간다. */
    const onTransitionRun = (event: TransitionEvent) => {
      if (event.target === nav && event.propertyName === 'top') observe();
    };
    if (typeof IntersectionObserver !== 'undefined') {
      observe();
      nav.addEventListener('transitionrun', onTransitionRun);
    }

    return () => {
      cancelSettle?.();
      observer?.disconnect();
      nav.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
      nav.removeEventListener('transitionrun', onTransitionRun);
    };
  }, [anchors]);

  return (
    <nav aria-label="캠페인 목차" className="wc-campaign-nav" ref={navRef}>
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
