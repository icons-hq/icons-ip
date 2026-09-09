"use client";

import { useEffect, useRef, useState } from "react";
import { ZONE_WATCH, ASSET } from "./aouad-data";
import { useFaceVisible, usePageVisible, usePrefersReducedMotion, useRotator } from "./deal-format";
import s from "./SceneHero.module.css";
import { syncHeroPlayback } from "../../lib/stage/hero-playback";

const HOLD_MS = 5000;

/* 재생은 현재 보이는 무대만 소유한다. 숨김·탭 전환·언마운트는 재생 대기 작업도 취소한다. */
function HeroVideo({ src, poster, active }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return undefined;
    return syncHeroPlayback(video, active);
  }, [active, failed, src]);

  if (failed) return <i className={s.frame} data-on="1" style={{ backgroundImage: `url(${poster})` }} />;
  return <video ref={ref} className={s.video} src={src} poster={poster} muted loop playsInline
    preload={active ? "metadata" : "none"} onError={() => setFailed(true)} aria-hidden="true" />;
}

export default function SceneHero({ id, fallback }) {
  const frameRef = useRef(null);
  const seen = useFaceVisible(frameRef, 0.2);
  const pageVisible = usePageVisible();
  const reduced = usePrefersReducedMotion();
  const watch = ZONE_WATCH[id] || {};
  const shots = watch.stills?.length ? watch.stills : [fallback].filter(Boolean);
  const active = seen && pageVisible && !reduced;
  const position = useRotator(shots.length, HOLD_MS, active && !watch.video);
  const at = reduced ? 0 : position;
  const poster = watch.video?.poster || shots[0] || fallback;

  return (
    <div className={s.frames} ref={frameRef} aria-hidden="true">
      {watch.video
        ? reduced
          ? <i className={s.frame} data-on="1" style={{ backgroundImage: `url(${ASSET(poster)})` }} />
          : <HeroVideo key={watch.video.src} src={ASSET(watch.video.src)} poster={ASSET(poster)} active={active} />
        : shots.map((file, index) => (
          <i key={file} className={s.frame} data-on={index === at ? "1" : "0"}
            style={{ backgroundImage: `url(${ASSET(file)})` }} />
        ))}
      <span className={s.scrim} />
    </div>
  );
}
