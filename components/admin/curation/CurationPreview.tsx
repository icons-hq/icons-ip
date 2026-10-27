'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Home } from '@/components/screens/Home';
import { CollectionBanners } from '@/components/shop/CollectionBanners';
import type { CollectionBanner } from '@/lib/collection-banners';
import { Icon } from '@/components/ui/Icon';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { isCardRewardDestination, isCommunityDestination, type HomeCurationSnapshot, type NoticeStrip } from '@/lib/home-catalog';
import { suggestedSearchHref } from '@/lib/search-terms';
import { shellNoticeDestinationAllowed, type ShellNoticeBar } from '@/lib/shell-notices';

export type CurationPreviewDevice = 'mobile' | 'desktop';

const PREVIEW_DOCUMENT = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>스토어 전시 미리보기</title></head><body style="margin:0"><div id="curation-preview-root"></div></body></html>';

/** A script-free document gives public CSS and picture sources their real viewport. */
export function CurationPreview({
  cardRewardsEnabled,
  collectionBanner = null,
  curation,
  device,
  noticeBar = null,
  noticeStrip,
  searchTerms = null,
}: {
  cardRewardsEnabled: boolean;
  /** 컬렉션 배너 초안(L8b) — 홈 대신 컬렉션 머리 배너로 보여 준다. */
  collectionBanner?: CollectionBanner | null;
  curation: HomeCurationSnapshot;
  device: CurationPreviewDevice;
  noticeBar?: ShellNoticeBar | null;
  noticeStrip: NoticeStrip | null;
  /** 추천 검색어 초안(L8b) — 홈 대신 검색 오버레이의 칩 행으로 보여 준다. */
  searchTerms?: readonly string[] | null;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const viewportWidth = device === 'mobile' ? 390 : 1212;
  const scale = stageWidth > 0 ? Math.min(1, stageWidth / viewportWidth) : 1;

  const mountFrame = useCallback(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;
    if (!frameDocument.head.querySelector('[data-store-preview-style]')) {
      document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-store-preview-style', '');
        frameDocument.head.append(clone);
      });
    }
    setPortalRoot(frameDocument.getElementById('curation-preview-root'));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const visibleNotice = noticeStrip
    && (cardRewardsEnabled || !isCardRewardDestination(noticeStrip.href))
    && (COMMUNITY_ENABLED || !isCommunityDestination(noticeStrip.href));
  const visibleBar = noticeBar
    && shellNoticeDestinationAllowed(noticeBar.cta?.href ?? null, { cardRewardsEnabled, communityEnabled: COMMUNITY_ENABLED })
    ? noticeBar : null;

  return (
    <div className="admin-store-editor__preview-stage" ref={stageRef}>
      <div
        className="admin-store-editor__preview-viewport"
        data-device={device}
        style={{ width: stageWidth > 0 ? viewportWidth * scale : '100%' }}
      >
        {stageWidth > 0 ? <iframe
          className="admin-store-editor__preview-frame"
          data-preview-ready={Boolean(portalRoot)}
          onLoad={mountFrame}
          ref={frameRef}
          sandbox="allow-same-origin"
          srcDoc={PREVIEW_DOCUMENT}
          style={{ width: viewportWidth, height: `${100 / scale}%`, minHeight: 620 / scale, transform: `scale(${scale})` }}
          title={`${device === 'mobile' ? '모바일' : 'PC'} 스토어 미리보기`}
        /> : <p role="status">미리보기 준비 중…</p>}
        {portalRoot ? createPortal(
          <div
            onAuxClickCapture={(event) => {
              if ((event.target as HTMLElement).closest('a')) event.preventDefault();
            }}
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest('a')) event.preventDefault();
            }}
          >
            {/* 공개 셸과 같은 마크업·CSS로 텍스트 공지 바를 띠배너 위에 그린다. 미리보기에서는 닫지 않는다. */}
            {visibleBar ? (
              <div className="wc-root wc-chrome">
                <aside aria-label="스토어 공지" className="wc-notice-bar">
                  <p className="wc-notice-bar__body">
                    <span className="wc-notice-bar__message">{visibleBar.message}</span>
                    {visibleBar.cta ? <a className="wc-notice-bar__cta" href={visibleBar.cta.href}>{visibleBar.cta.label}</a> : null}
                  </p>
                  <span aria-hidden className="wc-notice-bar__close"><Icon name="close" size={16} /></span>
                </aside>
              </div>
            ) : null}
            {visibleNotice ? (
              <div className="wc-root wc-chrome">
                <a className="wc-notice" href={noticeStrip.href}>
                  <picture>
                    {noticeStrip.mobileImageUrl ? <source media="(max-width: 749px)" srcSet={noticeStrip.mobileImageUrl} /> : null}
                    <img alt={noticeStrip.title} src={noticeStrip.imageUrl} />
                  </picture>
                </a>
              </div>
            ) : null}
            {collectionBanner ? (
              /* 공개 컬렉션과 같은 마크업·CSS — BEST·NEW 배너는 콘텐츠 폭 안에 선다. */
              <div className="wc-root wc-collection wc-collection--banner">
                {collectionBanner.slot === 'all' ? <CollectionBanners banners={[collectionBanner]} slot="all" /> : null}
                <div className="wc-container">
                  {collectionBanner.slot !== 'all' ? <CollectionBanners banners={[collectionBanner]} slot={collectionBanner.slot} /> : null}
                  <p className="admin-store-editor__preview-note">배너 아래에는 이 컬렉션의 상품 목록이 이어집니다.</p>
                </div>
              </div>
            ) : searchTerms ? (
              /* 검색 오버레이 패널의 칩 행만 그린다(입력·포커스 잠금 없이 모양만). */
              <div className="wc-root wc-chrome">
                <div className="wc-container wc-search__chips">
                  <p className="wc-search__chips-label">추천</p>
                  {searchTerms.map((term, index) => <a className="wc-search__chip" href={suggestedSearchHref(term)} key={`${term}-${index}`}>{term}</a>)}
                </div>
              </div>
            ) : <Home cardRewardsEnabled={cardRewardsEnabled} curation={curation} refreshScheduledContent={false} />}
          </div>,
          portalRoot,
        ) : null}
      </div>
    </div>
  );
}
