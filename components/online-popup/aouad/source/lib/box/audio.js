// 상자 효과음 — 조작에 붙는다.
//
// 자동 재생하지 않는다. 첫 조작에서 열고, 그전에는 아무 소리도 내지 않는다.
// 볼륨은 파일에 이미 위계로 구워져 있다(사건 0.75 / 경고 0.55 / 틱 0.40) —
// 여기서 다시 조절하면 그 위계가 깨진다.

const SFX = "/ip-popups/aouad/sfx/";
const cache = new Map();
let unlocked = false;

export function unlockAudio() { unlocked = true; }

export function stopAudio() {
  for (const audio of cache.values()) {
    try { audio.pause(); audio.currentTime = 0; } catch { /* Optional audio. */ }
  }
}

export function playSfx(name) {
  if (!unlocked || typeof Audio === "undefined") return;
  try {
    let a = cache.get(name);
    if (!a) { a = new Audio(`${SFX}${name}.mp3`); a.preload = "auto"; cache.set(name, a); }
    a.currentTime = 0;
    void a.play().catch(() => {});   // 브라우저가 막으면 조용히 넘어간다
  } catch { /* 소리는 있으면 좋은 것이지 없으면 막히는 것이 아니다 */ }
}

/** 룸톤 — 효과음보다 12 LU 아래로 구워져 있다. 반복만 켠다. */
export function ambience(on) {
  if (typeof Audio === "undefined") return;
  try {
    let a = cache.get("__amb");
    if (!a) { a = new Audio(`${SFX}amb-corridor-loop.mp3`); a.loop = true; cache.set("__amb", a); }
    if (on && unlocked) void a.play().catch(() => {});
    else a.pause();
  } catch { /* 상동 */ }
}
