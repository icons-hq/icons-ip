'use client';
import { useEffect, useRef, useState } from 'react';
import type { GoodsMediaAsset } from '@/lib/goods-media';
import { goodsImageBackground } from '@/lib/goods-image';
import { imageUrlFromBg } from '@/lib/media';

export const GOODS_VIDEO_LOAD_TIMEOUT_MS = 12_000;
export function GoodsVideoPlayer({ asset, active = true, fallbackBackground, className = '' }: {
  asset: GoodsMediaAsset; active?: boolean; fallbackBackground?: string; className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);
  const stopTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const fail = () => { stopTimer(); video.current?.pause(); setFailed(true); };
  const watch = () => { stopTimer(); timer.current = setTimeout(fail, GOODS_VIDEO_LOAD_TIMEOUT_MS); };
  useEffect(() => {
    const element = video.current;
    if (!active) { element?.pause(); stopTimer(); return; }
    if (element && element.readyState < 2) watch();
    return stopTimer;
    // The asset is immutable; changing it remounts the keyed player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, asset.id]);
  return <div className={`wc-goods-video ${className}`} data-media-failed={failed || undefined}>
    {failed ? <div className="wc-goods-video__fallback" style={fallbackBackground ? { background: goodsImageBackground(fallbackBackground) } : undefined}>
      <p role="status">{fallbackBackground ? '영상을 불러오지 못해 대표 이미지를 보여드려요.' : '영상을 불러오지 못했습니다.'}</p>
    </div> : <video ref={video} aria-label={asset.title} controls playsInline preload={active ? 'metadata' : 'none'} data-member-activity-asset={asset.id} data-member-activity-active={String(active)}
      poster={fallbackBackground ? imageUrlFromBg(fallbackBackground) ?? undefined : undefined}
      onLoadedMetadata={stopTimer} onLoadedData={stopTimer} onCanPlay={stopTimer} onError={fail} onPause={stopTimer}
      onWaiting={() => { if (!video.current?.paused) watch(); }} onStalled={() => { if (!video.current?.paused) watch(); }}>
      <source src={asset.url} type={`video/mp4; codecs="${asset.videoCodec}${asset.audioCodec ? `, ${asset.audioCodec}` : ''}"`} onError={fail} />
      영상 재생을 지원하는 브라우저에서 확인해주세요.
    </video>}
  </div>;
}
