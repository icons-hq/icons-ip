/* Intersection, document visibility and component lifetime jointly own a hero video. */
const playbackOwners = new WeakMap();
export function syncHeroPlayback(video, active, isHidden = () => document.visibilityState === "hidden") {
  let current = true;
  const owner = {};
  playbackOwners.set(video, owner);
  const ownsPlayback = () => playbackOwners.get(video) === owner;
  video.muted = true;
  if (active && !isHidden()) {
    try {
      void Promise.resolve(video.play()).then(() => {
        if (ownsPlayback() && (!current || isHidden())) video.pause();
      }).catch(() => { if (ownsPlayback()) video.pause(); });
    } catch { video.pause(); }
  } else {
    video.pause();
    try { video.currentTime = 0; } catch { /* Media metadata has not loaded yet. */ }
  }
  return () => { current = false; if (ownsPlayback()) video.pause(); };
}
