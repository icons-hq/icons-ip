'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Home } from '@/components/screens/Home';
import { Icon } from '@/components/ui/Icon';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { isCardRewardDestination, isCommunityDestination, type HomeCurationSnapshot, type NoticeStrip } from '@/lib/home-catalog';
import { shellNoticeDestinationAllowed, type ShellNoticeBar } from '@/lib/shell-notices';

export type CurationPreviewDevice = 'mobile' | 'desktop';

const PREVIEW_DOCUMENT = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>스토어 전시 미리보기</title></head><body style="margin:0"><div id="curation-preview-root"></div></body></html>';

/** A script-free document gives public CSS and picture sources their real viewport. */
export function CurationPreview({
  cardRewardsEnabled,
  curation,
  device,
  noticeBar = null,
  noticeStrip,
}: {
  cardRewardsEnabled: boolean;
  curation: HomeCurationSnapshot;
  device: CurationPreviewDevice;
  noticeBar?: ShellNoticeBar | null;
  noticeStrip: NoticeStrip | null;
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
            <Home cardRewardsEnabled={cardRewardsEnabled} curation={curation} refreshScheduledContent={false} />
          </div>,
          portalRoot,
        ) : null}
      </div>
    </div>
  );
}
