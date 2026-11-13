'use client';

import Link, { useLinkStatus } from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaimPreviewFullScreenLink } from './ClaimPreviewDialog';
import { ClaimPreviewKitDialog } from './ClaimPreviewKitDialog';

/*
 * 주문 관련 목록 위 주문 상세 팝업(S36-075, 2026-11-11 결정 "목록 위 상세 팝업"). 클레임 목록 팝업(R8)의 kit 판
 * (ClaimPreviewKitDialog)을 그대로 쓴다 — 주소(`?orderId=`)로 열고, 닫으면 같은 조건의 목록으로 스크롤을 유지한 채
 * 돌아가며, 안의 처리 패널이 기다리는 동안 닫히지 않는 계약도 같다. 목록·선택·스크롤은 같은 화면이라 그대로다.
 * 새 탭 열기는 행의 보조 링크로 남긴다.
 */

/** 링크를 누른 순간부터 팝업이 열릴 때까지 '여는 중'을 보인다. 자리는 늘 차지해 줄이 흔들리지 않는다. */
function OrderPreviewPendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className="text-[11px] font-normal text-muted-foreground opacity-0 transition-opacity data-[pending=true]:opacity-100 motion-reduce:transition-none"
    data-pending={pending ? 'true' : undefined}>여는 중</span>;
}

/**
 * 주문번호 링크 — 같은 목록 위에 상세 팝업을 연다. 목록 스크롤을 유지하고 행마다 상세를 미리 읽지 않는다
 * (prefetch=false — 한 페이지 100행의 상세를 미리 부르지 않는다).
 */
export function OrderPreviewLink({ href, label, children, className = 'font-medium tabular-nums underline-offset-4 hover:underline', tabStop = true }: {
  href: string; label: string; children: ReactNode; className?: string;
  /** false면 Tab에서 뺀다(마우스·스크린리더 이름은 그대로). 같은 행에 같은 목적지의 대표 링크가 따로 있을 때 쓴다(ADM-016 #8). */
  tabStop?: boolean;
}) {
  return <Link aria-label={label} className={`inline-flex items-baseline gap-1.5 ${className}`} data-order-preview-link="" href={href} prefetch={false} scroll={false} tabIndex={tabStop ? undefined : -1}>
    {children}<OrderPreviewPendingHint />
  </Link>;
}

/** 보조 링크: 전용 상세 화면을 새 탭으로 연다(기존 동작). 같은 주문의 대표 링크(상세 팝업)가 있어 Tab에서는 뺀다 — 팝업 안에 새 탭 링크가 있다(ADM-016 #8). */
export function OrderPreviewNewTabLink({ href, label }: { href: string; label: string }) {
  return <a aria-label={label} className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    href={href} rel="noopener noreferrer" tabIndex={-1} target="_blank" title="새 탭으로 열기"><ExternalLink aria-hidden="true" className="size-3.5" /></a>;
}

export function OrderPreviewDialog({ children, closeHref, detailHref, title }: { children: ReactNode; closeHref: string; detailHref: string; title: string }) {
  return <ClaimPreviewKitDialog closeHref={closeHref} title={title}>
    <div className="flex flex-wrap items-center gap-2" data-order-preview-tools="">
      <ClaimPreviewFullScreenLink href={detailHref} />
      <a className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href={detailHref} rel="noopener noreferrer" target="_blank">새 탭으로 열기</a>
    </div>
    {children}
  </ClaimPreviewKitDialog>;
}
