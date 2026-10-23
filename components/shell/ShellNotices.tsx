'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import {
  applicableShellNotices,
  firstVisibleNoticeBar,
  noticeStripIndex,
  readDismissedNoticeKeys,
  readShellNoticeSeed,
  rememberDismissedNotice,
  SHELL_NOTICE_ROOT_ID,
  SHELL_NOTICE_SCRIPT,
  type ShellNotices as ShellNoticeData,
} from '@/lib/shell-notices';
import { analyticsPage } from '@/lib/store-analytics';
import { beginShellNoticePageView, recordShellNoticeEvent } from '@/lib/store-analytics-client';
import { InlineScript } from './InlineScript';

function browserSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserScope(): Record<string, unknown> | null {
  return typeof window === 'undefined' ? null : window as unknown as Record<string, unknown>;
}

/* 방문 통계와 같은 공개 화면에서만 노출·클릭을 센다(회원·주문·결제·검색 화면 제외 — 방문 통계 안내와 같은 범위). */
function isMeasuredPath(pathname: string): boolean {
  return analyticsPage(pathname, new URLSearchParams()) !== null;
}

/*
 * 전역 셸 공지 — 이미지 스트립 위에 텍스트 공지 바를 쌓는다(11 §3 Δ1). 둘 다 유틸바 위라 축약 기준(B1)에
 * 실제 공지 높이가 그대로 더해지고(Nav의 noticeOffsetAbove), 스크롤과 함께 빠져나가 sticky 크롬 높이·해시 착지선은 바뀌지 않는다.
 *
 * 서버 렌더는 결정적이다: 이 화면 유형에 맞는 공지를 모두 그리되 첫 공지 바·첫 스트립만 보이고 나머지는 hidden.
 * 바로 뒤 인라인 스크립트가 첫 페인트 전에 같은 탭의 닫힘 기록·하드 로드 시드로 hidden을 고치고, 이 컴포넌트는 같은
 * 저장소·시드를 lazy 초기값으로 읽어 같은 결과로 하이드레이트한다 — 닫은 공지가 깜빡였다 사라지거나 스트립이 바뀌며 밀리지 않는다.
 * 닫으면 hidden(display:none)이라 빈 띠가 남지 않는다.
 */
export function ShellNotices({
  notices,
  pathname,
  cardRewardsEnabled,
}: {
  notices: ShellNoticeData;
  pathname: string;
  cardRewardsEnabled: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const impressionsRef = useRef<{ pathname: string; ids: Set<string> }>({ pathname: '', ids: new Set() });
  const [dismissed, setDismissed] = useState<readonly string[]>(() => readDismissedNoticeKeys(browserSessionStorage()));
  const [seed] = useState(() => readShellNoticeSeed(browserScope()));
  const { bars, strips } = applicableShellNotices(notices, pathname, { cardRewardsEnabled, communityEnabled: COMMUNITY_ENABLED });
  const visibleBar = firstVisibleNoticeBar(bars, dismissed);
  const visibleBarKey = visibleBar?.key ?? null;
  const stripIndex = noticeStripIndex(seed, strips.length);
  const visibleStripId = strips[stripIndex]?.id ?? null;
  const measured = isMeasuredPath(pathname);

  /* 노출은 화면에 절반 이상 보였을 때 화면(경로)당 공지마다 한 번 센다. 다음 공지 바로 바뀌어도 이미 센 스트립은 다시 세지 않는다. */
  useEffect(() => {
    if (!measured) return;
    beginShellNoticePageView(pathname);
    if (typeof IntersectionObserver === 'undefined') return;
    if (impressionsRef.current.pathname !== pathname) impressionsRef.current = { pathname, ids: new Set() };
    const seen = impressionsRef.current.ids;
    const targets = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-notice-id]:not([hidden])') ?? [])
      .filter((target) => !seen.has(target.dataset.noticeId ?? ''));
    if (targets.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.noticeId;
        if (!entry.isIntersecting || !id || seen.has(id)) continue;
        seen.add(id);
        observer.unobserve(entry.target);
        recordShellNoticeEvent(id, 'impression');
      }
    }, { threshold: 0.5 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [measured, pathname, visibleBarKey, visibleStripId]);

  if (notices.bars.length === 0 && notices.strips.length === 0) return null;

  const recordClick = (id: string) => {
    if (measured) recordShellNoticeEvent(id, 'click');
  };

  /* 닫은 버튼이 사라지면 포커스가 문서 처음으로 튄다 — 다음 공지의 조작부, 없으면 로고로 옮긴다. */
  const dismiss = (key: string) => {
    flushSync(() => setDismissed(rememberDismissedNotice(browserSessionStorage(), key)));
    const next = rootRef.current?.querySelector<HTMLElement>(
      '[data-notice-bar]:not([hidden]) .wc-notice-bar__close, [data-notice-strip]:not([hidden])',
    ) ?? document.querySelector<HTMLElement>('.wc-chrome .wc-logo');
    next?.focus();
  };

  return (
    <>
      {bars.length > 0 || strips.length > 0 ? (
        <div className="wc-notices" id={SHELL_NOTICE_ROOT_ID} ref={rootRef}>
          {bars.map((bar) => (
            <aside
              key={bar.key}
              aria-label="스토어 공지"
              className="wc-notice-bar"
              data-notice-bar={bar.key}
              data-notice-id={bar.id}
              hidden={bar !== visibleBar}
              suppressHydrationWarning
            >
              <p className="wc-notice-bar__body">
                <span className="wc-notice-bar__message">{bar.message}</span>
                {bar.cta ? (
                  <Link className="wc-notice-bar__cta" href={bar.cta.href} onClick={() => recordClick(bar.id)}>
                    {bar.cta.label}
                  </Link>
                ) : null}
              </p>
              <button aria-label="공지 닫기" className="wc-notice-bar__close" onClick={() => dismiss(bar.key)} type="button">
                <Icon name="close" size={16} />
              </button>
            </aside>
          ))}
          {/* 스트립은 이미지 비율만큼 높이를 차지하는 링크 배너다(R-01 §1). PC 비율 아트웍은 모바일 폭에서 수 px로
              붕괴하므로 모바일 소스를 분기한다. 후보가 여럿이면 보이지 않는 후보의 이미지는 내려받지 않는다(lazy + hidden). */}
          {strips.map((strip, index) => (
            <Link
              key={strip.id}
              className="wc-notice"
              data-notice-id={strip.id}
              data-notice-strip={strip.id}
              hidden={index !== stripIndex}
              href={strip.href}
              onClick={() => recordClick(strip.id)}
              suppressHydrationWarning
            >
              <picture>
                {strip.mobileImageUrl ? <source media="(max-width: 749px)" srcSet={strip.mobileImageUrl} /> : null}
                <img alt={strip.title} loading={strips.length > 1 ? 'lazy' : undefined} src={strip.imageUrl} />
              </picture>
            </Link>
          ))}
        </div>
      ) : null}
      <InlineScript html={SHELL_NOTICE_SCRIPT} />
    </>
  );
}
