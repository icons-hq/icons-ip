'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { AdminStatusBadge } from './console/AdminKit';
import { Button } from './kit/ui/button';

/*
 * SHEET-027(MD-0019): 리뷰 관리 화면의 '고객 화면 노출 예시' 틀. 상품 상세·목록이 실제 창 폭에 따라 달라지므로
 * 스크립트 없는 문서(iframe)에 공개 CSS를 옮겨 그 폭(모바일 390·PC 1212)에서 그린다 — 홈·카테고리 전시 미리보기와 같은 방식.
 * 예시는 펼쳤을 때만 만든다. 안쪽은 inert로 누르거나 포커스할 수 없고, 링크 이동·폼 제출도 캡처 단계에서 한 번 더 막는다
 * (리뷰 신고·도움이 돼요 같은 공개 동작이 합성 리뷰로 서버에 가지 않게).
 */

export type ReviewExampleDevice = 'mobile' | 'desktop';
export const REVIEW_EXAMPLE_VIEWPORTS: Record<ReviewExampleDevice, number> = { mobile: 390, desktop: 1212 };
const STAGE_HEIGHT = 720;
const FRAME_DOCUMENT = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>리뷰 노출 예시</title></head><body style="margin:0"><div id="review-example-root" class="wc-root"></div></body></html>';
const SEGMENTED = 'inline-flex items-center rounded-lg bg-muted p-0.5';
const SEGMENT = 'h-7 rounded-md px-2.5 text-[0.8rem] text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';
/* 셸 헤더가 없는 예시 문서라 상품 상세 탭바의 고정 위치(헤더 높이만큼 아래)를 0으로 둔다. */
const FRAME_CONTENT_STYLE = { '--wc-sticky-chrome-h': '0px' } as CSSProperties;

const block = (event: SyntheticEvent) => { event.preventDefault(); };

/** 예시 안쪽. 아무것도 누르거나 보낼 수 없다. */
export function ReviewExampleFrameContent({ children }: { children: ReactNode }) {
  return <div data-review-example-content="" inert onAuxClickCapture={block} onClickCapture={block} onSubmitCapture={block} style={FRAME_CONTENT_STYLE}>{children}</div>;
}

function ReviewExampleFrame({ device, children }: { device: ReviewExampleDevice; children: ReactNode }) {
  const frameRef = useRef<HTMLIFrameElement>(null), stageRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null), [stageWidth, setStageWidth] = useState(0);
  const viewport = REVIEW_EXAMPLE_VIEWPORTS[device], scale = stageWidth > 0 ? Math.min(1, stageWidth / viewport) : 1;
  const mount = useCallback(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;
    if (!frameDocument.head.querySelector('[data-review-example-style]')) {
      document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-review-example-style', '');
        frameDocument.head.append(clone);
      });
    }
    setPortalRoot(frameDocument.getElementById('review-example-root'));
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  /* 관리자 쪽 틀만 유틸리티로 그린다(ADR-0028) — iframe 안은 공개 스토어프런트 그대로다. */
  return <div className="min-w-0 overflow-hidden rounded-lg bg-muted" data-device={device} data-review-example-stage="" ref={stageRef}>
    <div className="mx-auto" style={{ width: stageWidth > 0 ? viewport * scale : '100%', height: STAGE_HEIGHT }}>
      {stageWidth > 0 ? <iframe className="block border-0 bg-background" data-preview-ready={Boolean(portalRoot)} onLoad={mount} ref={frameRef} sandbox="allow-same-origin" srcDoc={FRAME_DOCUMENT}
        style={{ width: viewport, height: STAGE_HEIGHT / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        title={`${device === 'mobile' ? '모바일' : 'PC'} 리뷰 노출 예시(예시 데이터)`} /> : <p className="p-4 text-sm text-muted-foreground" role="status">예시 화면을 준비하는 중…</p>}
      {portalRoot ? createPortal(<ReviewExampleFrameContent>{children}</ReviewExampleFrameContent>, portalRoot) : null}
    </div>
  </div>;
}

/** 리뷰 관리 화면 아래에 늘 있는 예시 패널. 펼쳤을 때만 예시 화면을 만든다(첫 화면은 처리할 리뷰가 차지한다). */
export function ReviewDisplayExamplePanel({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [device, setDevice] = useState<ReviewExampleDevice>('mobile');
  return <details className="group/review-example min-w-0 rounded-xl border bg-card text-card-foreground" data-review-display-example="" onToggle={event => setOpen(event.currentTarget.open)} open={open}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
      고객 화면 노출 예시 (PC·모바일)<AdminStatusBadge tone="neutral">예시 데이터</AdminStatusBadge>
      <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform group-open/review-example:rotate-180 motion-reduce:transition-none" />
    </summary>
    {open ? <div className="flex min-w-0 flex-col gap-3 border-t px-4 py-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        실제 고객 화면과 같은 부품을 <strong className="font-medium text-foreground">가짜(예시) 리뷰</strong>로 그린 화면입니다. 예시 리뷰는 저장되지 않으며 고객 화면·리뷰 집계·엑셀에 나오지 않습니다.
        상품 목록 카드, 상품 상세 가격 아래 별점 줄, 상단 리뷰 요약(켠 경우), &ldquo;리뷰 (N)&rdquo; 탭 순서로 보여 줍니다. 예시 안의 버튼과 링크는 눌리지 않습니다.
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        상단 리뷰 요약과 대표이미지의 BEST 리뷰는 스토어 전시관리 &gt; <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/display/detail">상품 상세 구성</Link>에서 켠 경우에만 고객에게 보입니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div aria-label="예시 화면 크기" className={SEGMENTED} role="group">
          <Button aria-pressed={device === 'mobile'} className={SEGMENT} onClick={() => setDevice('mobile')} size="sm" type="button" variant="ghost">모바일</Button>
          <Button aria-pressed={device === 'desktop'} className={SEGMENT} onClick={() => setDevice('desktop')} size="sm" type="button" variant="ghost">PC</Button>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">화면 폭 {REVIEW_EXAMPLE_VIEWPORTS[device]}px · 예시 안에서 스크롤해 아래까지 볼 수 있습니다.</span>
      </div>
      <ReviewExampleFrame device={device}>{children}</ReviewExampleFrame>
    </div> : null}
  </details>;
}
