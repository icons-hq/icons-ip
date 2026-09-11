'use client';

import { useState } from 'react';
import type { AdminArtworkKind } from '@/lib/admin/artwork';

const GOODS_CROPS = [
  { label: '공개 목록·모바일 상세 · 3:4', ratio: '3 / 4' },
  { label: '데스크톱 상세 · 1:1', ratio: '1 / 1' },
];
const IP_CROPS = [
  { label: '온라인 팝업 목록 · 1:1', ratio: '1 / 1' },
  { label: 'PC 배너 · 1440×540 예시', ratio: '1440 / 540' },
  { label: '모바일 배너 · 390×420 예시', ratio: '390 / 420' },
];

/** Uses the same centered cover crop as the public catalog; the uploaded file is unchanged. */
export function ArtworkCropGuide({ kind, src, detailImage = false }: {
  kind: AdminArtworkKind;
  src: string | null;
  detailImage?: boolean;
}) {
  const [size, setSize] = useState<{ src: string; width: number; height: number }>();
  if (kind !== 'good' && kind !== 'ip') return null;
  const crops = kind === 'ip' ? IP_CROPS : GOODS_CROPS;
  return <details className="wc-admin-artwork-guide">
    <summary>이미지 권장 규격과 공개 화면 잘림 확인</summary>
    <p>{kind === 'ip'
      ? 'IP 원본은 1920×1080px를 권장합니다. 목록은 정방형이며 배너는 화면 너비와 문구 길이에 따라 잘림이 달라집니다. 인물·로고는 중앙에 배치해주세요.'
      : detailImage
        ? '상세 이미지는 본문에서 원래 비율을 유지합니다. 대표·갤러리 이미지의 잘림 규칙과 다릅니다.'
        : '대표·갤러리 원본은 정방형 1000×1000px를 권장합니다. 공개 목록과 모바일 상세는 3:4, 데스크톱 상세는 1:1로 중앙을 기준으로 잘립니다. 글자·로고는 중앙 영역에 배치해주세요.'}</p>
    <p>위 업로더는 {kind === 'ip' ? '16:9' : '4:3'} 미리보기입니다. 원본 파일의 비율을 바꾸지 않습니다.</p>
    {src && size?.src === src ? <p>현재 이미지: {size.width.toLocaleString('ko-KR')}×{size.height.toLocaleString('ko-KR')}px</p> : null}
    {src ? <div className="wc-admin-artwork-guide__crops">
      {(detailImage ? [{ label: '상세 본문 · 원본 비율', ratio: 'auto' }] : crops).map((crop, index) => <figure key={crop.label}>
        <div className="wc-admin-artwork-guide__frame" style={{ aspectRatio: crop.ratio }}>
          {/* Local object URLs must render immediately, before an upload exists. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`${crop.label} 미리보기`} src={src} className={detailImage ? 'is-original' : undefined} onLoad={index === 0 ? (event) => {
            const img = event.currentTarget;
            setSize({ src, width: img.naturalWidth, height: img.naturalHeight });
          } : undefined} />
        </div>
        <figcaption>{crop.label}</figcaption>
      </figure>)}
    </div> : <p>이미지를 선택하면 같은 원본의 화면별 잘림을 비교할 수 있습니다.</p>}
  </details>;
}
