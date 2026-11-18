'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import {
  applicableShellNotices,
  forgetShellNoticeNow,
  initialShellNoticeNow,
  nextShellNoticeEnd,
  noticeStripDimensions,
  readDismissedNoticeKeys,
  readShellNoticeBarSeed,
  readShellNoticeSeed,
  rememberDismissedNotices,
  SHELL_NOTICE_IMPRESSION_RATIO,
  shellNoticeImpressionVisible,
  SHELL_NOTICE_ROOT_ID,
  SHELL_NOTICE_SCRIPT,
  shellNoticePageType,
  shellNoticeTimerDelay,
  stableNoticeBar,
  visibleNoticeBar,
  visibleNoticeStripIndex,
  type ShellNoticeBarPins,
  type ShellNotices as ShellNoticeData,
} from '@/lib/shell-notices';
import { enterShellNoticeView, leaveShellNoticeView, recordShellNoticeEvent, shellNoticeSeen } from '@/lib/store-analytics-client';
import { InlineScript } from './InlineScript';
import { isActivationTarget } from './overlay-focus';
import { RollingNoticeBody } from './RollingNoticeBody';
import { useCollectibleFeatures } from './CollectibleFeatures';

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

/*
 * 전역 셸 공지 — 이미지 스트립 위에 텍스트 공지 바를 쌓는다(11 §3 Δ1). 둘 다 유틸바 위라 축약 기준(B1)에
 * 실제 공지 높이가 그대로 더해지고(Nav의 noticeOffsetAbove), 스크롤과 함께 빠져나가 sticky 크롬 높이·해시 착지선은 바뀌지 않는다.
 * 텍스트 공지 바는 Figma의 빨간 롤링 띠배너다(ADR-0043) — 문구가 오른쪽에서 왼쪽으로 흐르고, 같은 화면 후보가 여럿이면
 * 하드 로드마다 무작위 하나만 보인다(이미지 스트립과 같은 방식, 시드는 따로). 닫으면 이 화면의 모든 후보가 같은 탭 동안 닫힌다.
 *
 * 서버 렌더는 결정적이다: 이 화면 유형에 맞는 공지를 모두 그리되 첫 공지 바·첫 스트립만 보이고 나머지는 hidden.
 * 바로 뒤 인라인 스크립트가 첫 페인트 전에 같은 탭의 닫힘 기록·하드 로드 시드·지금 시각(끝난 공지 숨김)으로 hidden을 고치고,
 * 이 컴포넌트는 같은 저장소·시드·판정 시각을 lazy 초기값으로 읽어 같은 결과로 하이드레이트한다 — 닫은 공지가 깜빡였다
 * 사라지거나 스트립이 바뀌며 밀리지 않는다. 닫거나 끝나면 hidden(display:none)이라 빈 띠가 남지 않는다.
 * 셸 공지는 하드 로드 때만 내려오므로, 열린 화면에서는 다음 종료 시각에 맞춘 타이머로 끝난 공지를 숨긴다.
 * 보이는 공지 바는 처음 고른 것을 화면 유형별로 고정한다 — 카드 리워드 게이트는 마운트 뒤에야 확정돼(서버·하이드레이션은 꺼짐) 후보가 늘 수 있고,
 * 그때 같은 시드로 다시 고르면 보이던 문구가 바뀌고 노출이 두 번 집계된다. 게이트가 고른 공지를 막을 때만 다시 고른다(stableNoticeBar).
 */
export function ShellNotices({
  notices,
  pathname,
  cardRewardsEnabled,
  onActivate,
}: {
  notices: ShellNoticeData;
  pathname: string;
  cardRewardsEnabled: boolean;
  /** 공지 안의 링크·버튼(이동·닫기)을 눌렀을 때 — 검색 패널이 열려 있으면 닫으려는 신호다(MD-0034). 동작은 그대로 하고 알리기만 한다. */
  onActivate?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<readonly string[]>(() => readDismissedNoticeKeys(browserSessionStorage()));
  const [seed] = useState(() => readShellNoticeSeed(browserScope()));
  const [barSeed] = useState(() => readShellNoticeBarSeed(browserScope()));
  const [now, setNow] = useState(() => initialShellNoticeNow(browserScope()));
  const collectibleFeatures = useCollectibleFeatures();
  const { bars, strips } = applicableShellNotices(notices, pathname, { cardRewardsEnabled, communityEnabled: COMMUNITY_ENABLED, collectibleFeatures });
  const pageType = shellNoticePageType(pathname);
  /* 첫 선택(서버·첫 페인트 전 스크립트·하이드레이션과 같은 결과)이 고정의 시작이다. 이후 렌더는 고정한 공지를 그대로 쓰고, 막혔을 때만 새로 고른 키로 갱신한다
     — 렌더 중 상태 보정(Nav 의 경로 리셋과 같은 방식)이라 값이 같으면 다시 그리지 않는다. */
  const [pins, setPins] = useState<ShellNoticeBarPins>(() => ({ [pageType]: visibleNoticeBar(bars, dismissed, now, barSeed)?.key ?? null }));
  const visibleBar = stableNoticeBar(bars, dismissed, now, barSeed, pins[pageType] ?? null);
  const visibleBarKey = visibleBar?.key ?? null;
  if ((pins[pageType] ?? null) !== visibleBarKey) setPins({ ...pins, [pageType]: visibleBarKey });
  const stripIndex = visibleNoticeStripIndex(strips, seed, now);
  const visibleStripId = strips[stripIndex]?.id ?? null;

  /* 하이드레이션은 스크립트의 판정 시각을 썼다 — 이후 다시 마운트되면 지금 시각으로 판정하게 지운다. */
  useEffect(() => forgetShellNoticeNow(browserScope()), []);

  /* 노출 종료: 다음으로 끝나는 공지의 종료 시각에 시각을 다시 읽어, 끝난 공지 바는 다음 공지 바로 넘기고 끝난 스트립은
     다른 후보로 넘기거나 숨긴다. 경로가 바뀔 때도 다시 재서, 늦게 깬 타이머가 있어도 다음 화면에서 끝난 공지를 오래 두지 않는다. */
  useEffect(() => {
    if (now === null) return;
    const endsAt = nextShellNoticeEnd(notices, now);
    if (endsAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), shellNoticeTimerDelay(endsAt, Date.now()));
    return () => window.clearTimeout(timer);
  }, [notices, now, pathname]);

  /* 셸이 사라지면(전용 셸 화면) 노출 화면을 닫는다 — 돌아오면 같은 경로여도 새 화면으로 센다(페이지뷰와 같은 경계). */
  useEffect(() => () => leaveShellNoticeView(), []);

  /* 노출은 화면에 절반 이상 보였을 때 화면(경로 한 번의 방문)당 공지마다 한 번 센다. 측정 밖 화면에서도 경로가 바뀌면
     새 화면을 시작해, 검색·장바구니를 거쳐 돌아온 홈은 다시 센다. 다음 공지 바로 바뀌어도 이미 센 스트립은 다시 세지 않는다.
     동의·상태 확인 전에 보인 공지는 lib/store-analytics-client가 그 화면의 페이지뷰 기록 뒤에 보낸다. */
  useEffect(() => {
    if (!enterShellNoticeView(pathname) || typeof IntersectionObserver === 'undefined') return;
    const targets = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-notice-id]:not([hidden])') ?? [])
      .filter((target) => !shellNoticeSeen(target.dataset.noticeId ?? ''));
    if (targets.length === 0) return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active) return;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.noticeId;
        if (!id || !shellNoticeImpressionVisible(entry)) continue;
        observer.unobserve(entry.target);
        recordShellNoticeEvent(id, 'impression');
      }
    }, { threshold: SHELL_NOTICE_IMPRESSION_RATIO });
    targets.forEach((target) => observer.observe(target));
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [pathname, visibleBarKey, visibleStripId]);

  if (notices.bars.length === 0 && notices.strips.length === 0) return null;

  /* 측정 밖 화면의 클릭은 lib/store-analytics-client가 버린다. */
  const recordClick = (id: string) => recordShellNoticeEvent(id, 'click');

  /* 링크·버튼의 원래 동작(이동·공지 닫기)이 먼저 끝난 뒤 — 닫기는 포커스를 옮기므로 그 뒤에 패널을 닫아야 패널이 포커스를 되돌려 뺏지 않는다. */
  const activate = onActivate
    ? (event: MouseEvent<HTMLDivElement>) => {
      if (isActivationTarget(event.target)) onActivate();
    }
    : undefined;

  /* 닫기는 이 화면에 적용되는 공지 바 후보 전부를 닫는다 — 무작위로 하나만 보이는데 닫았더니 다른 문구가 튀어나오면 닫기가 무의미하다.
     문구·버튼·대상을 바꾸면 키가 달라져 다시 보인다(기존 규칙). 닫은 버튼이 사라지면 포커스가 문서 처음으로 튄다 —
     다음 공지의 조작부, 없으면 로고로 옮긴다. */
  const dismiss = () => {
    flushSync(() => setDismissed((current) => rememberDismissedNotices(browserSessionStorage(), bars.map((bar) => bar.key), current)));
    const next = rootRef.current?.querySelector<HTMLElement>(
      '[data-notice-bar]:not([hidden]) .wc-notice-bar__close, [data-notice-strip]:not([hidden])',
    ) ?? document.querySelector<HTMLElement>('.wc-chrome .wc-logo');
    next?.focus();
  };

  return (
    <>
      {bars.length > 0 || strips.length > 0 ? (
        <div className="wc-notices" id={SHELL_NOTICE_ROOT_ID} onClick={activate} ref={rootRef}>
          {bars.map((bar) => (
            <aside
              key={bar.key}
              aria-label="스토어 공지"
              className="wc-notice-bar wc-x-rolling"
              data-notice-bar={bar.key}
              data-notice-ends={bar.endsAt ?? undefined}
              data-notice-id={bar.id}
              hidden={bar !== visibleBar}
              suppressHydrationWarning
            >
              <RollingNoticeBody cta={bar.cta} message={bar.message} onCtaClick={() => recordClick(bar.id)} />
              <button aria-label="공지 닫기" className="wc-notice-bar__close" onClick={dismiss} type="button">
                <Icon name="close" size={16} />
              </button>
            </aside>
          ))}
          {/* 스트립은 이미지 비율만큼 높이를 차지하는 링크 배너다(R-01 §1). PC 비율 아트웍은 모바일 폭에서 수 px로
              붕괴하므로 모바일 소스를 분기한다. 높이는 서버가 읽은 이미지 고유 크기(width·height)로 첫 페인트 전에 잡는다.
              크기를 읽지 못한 경우를 위해 이미지는 숨은 후보까지 모두 기본(eager)으로 받는다(l8a-qa-1): 높이를 미리
              알 수 없으면 이미지가 첫 페인트 뒤에 올 때 띠배너가 끼어들며 본문을 민다. 보일 후보를 고르는 첫 페인트 전 스크립트는
              head 스타일시트가 끝나야 돌기 때문에(로컬 실측 첫 페인트 15~20ms 전), 숨은 후보를 lazy로 미루면 그 후보가 뽑힌 하드 로드는
              이미지 요청이 그때서야 시작돼 실제 네트워크에서는 매번 늦는다. 모두 받으면 어느 후보가 뽑혀도 HTML 파싱 중 바로
              요청된다(main의 단일 스트립과 같은 시점) — 대가는 같은 화면 유형의 후보 수만큼 얇은 띠배너를 받는 것이다. */}
          {strips.map((strip, index) => {
            /* 이미지 고유 크기를 달아 띠 자리를 첫 페인트 전에 잡는다 — 이미지가 늦게 와도 본문을 밀지 않는다(CLS). */
            const size = noticeStripDimensions(strip);
            return (
              <Link
                key={strip.id}
                className="wc-notice"
                data-notice-ends={strip.endsAt ?? undefined}
                data-notice-id={strip.id}
                data-notice-strip={strip.id}
                hidden={index !== stripIndex}
                href={strip.href}
                onClick={() => recordClick(strip.id)}
                suppressHydrationWarning
              >
                <picture>
                  {strip.mobileImageUrl ? <source height={size.mobile?.height} media="(max-width: 749px)" srcSet={strip.mobileImageUrl} width={size.mobile?.width} /> : null}
                  <img alt={strip.title} height={size.image?.height} src={strip.imageUrl} width={size.image?.width} />
                </picture>
              </Link>
            );
          })}
        </div>
      ) : null}
      <InlineScript html={SHELL_NOTICE_SCRIPT} />
    </>
  );
}
