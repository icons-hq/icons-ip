'use client';

import { useState } from 'react';
import type { AdminArtworkKind } from '@/lib/admin/artwork';

const IP_CROPS = [
  { label: '온라인 팝업 목록 · 1:1', ratio: '1 / 1' },
  { label: 'PC 배너 · 1440×540 예시', ratio: '1440 / 540' },
  { label: '모바일 배너 · 390×420 예시', ratio: '390 / 420' },
];

/*
 * Uses the same centered cover crop as the public catalog; the uploaded file is unchanged.
 * 굿즈 이미지는 2026-10-07부터 고객 화면에서 잘리지 않고(1:1 contain) 표시되므로 잘림 예시를
 * 두지 않는다 — 상품 이미지 그리드의 1000×1000 권장 안내 한 줄이 대신한다.
 */
export function ArtworkCropGuide({ kind, src }: {
  kind: AdminArtworkKind;
  src: string | null;
}) {
  const [size, setSize] = useState<{ src: string; width: number; height: number }>();
  if (kind !== 'ip') return null;
  return <details className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed" data-artwork-guide="">
    <summary className="cursor-pointer font-medium">이미지 권장 규격과 공개 화면 잘림 확인</summary>
    <div className="mt-2 flex flex-col gap-2 text-muted-foreground">
      <p>IP 원본은 1920×1080px를 권장합니다. 목록은 정방형이며 배너는 화면 너비와 문구 길이에 따라 잘림이 달라집니다. 인물·로고는 중앙에 배치해주세요.</p>
      <p>위 업로더는 16:9 미리보기입니다. 원본 파일의 비율을 바꾸지 않습니다.</p>
      {src && size?.src === src ? <p className="text-foreground tabular-nums">현재 이미지: {size.width.toLocaleString('ko-KR')}×{size.height.toLocaleString('ko-KR')}px</p> : null}
      {src ? <div className="grid max-w-[42.5rem] grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-4">
        {IP_CROPS.map((crop, index) => <figure className="m-0 min-w-0" key={crop.label}>
          <div className="relative overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: crop.ratio }}>
            {/* Local object URLs must render immediately, before an upload exists. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${crop.label} 미리보기`} className="absolute inset-0 size-full max-w-none object-cover object-center" src={src} onLoad={index === 0 ? (event) => {
              const img = event.currentTarget;
              setSize({ src, width: img.naturalWidth, height: img.naturalHeight });
            } : undefined} />
          </div>
          <figcaption className="mt-1.5 text-xs">{crop.label}</figcaption>
        </figure>)}
      </div> : <p>이미지를 선택하면 같은 원본의 화면별 잘림을 비교할 수 있습니다.</p>}
    </div>
  </details>;
}
