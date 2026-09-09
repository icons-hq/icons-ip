/* ── 회차 무대 — 회차 하나가 어떤 판이고 어떤 그림을 쓰는가 ──
   화면 두 곳이 같은 판을 그린다(럭키드로우 존의 실제 판 · 허브 화면의 자기 얼굴).
   표가 컴포넌트 안에 있으면 둘 중 하나가 반드시 거짓말을 하게 된다 — 표를 밖에 둔다. */
export const KUJI_STAGE = {
  // kind "wall" — 벽 하나. 문이 곧 칸이고 열면 끝이다.
  k1: {
    kind: "wall",
    live: true,             // P5-a — 이 회차는 실제로 굴린다(PM 2026-08-31: G1 하나 먼저)
    seed: 20260828,
    theme: "그날 두고 간 것",
    hero: "stage-locker-hero.jpg",
    bg: "stage-locker-wall-bg.jpg",
    closed: "stage-locker-closed.png",
    open: "stage-locker-open.png",
    fx: "stage-locker-open-fx.png",
    unit: "칸",
  },
  // kind "shaft" — 3층. 넣는 곳 / 떨어지거나 이어지는 길 / 받는 곳.
  // 손을 떠난 뒤에도 화면에서 사건이 이어져야 하는 회차가 여기 온다.
  k2: {
    kind: "shaft",
    theme: "생존 키트",
    hero: "stage-drop-hero.jpg",
    bg: "stage-drop-bg.jpg",
    bgDim: 0.62,            // 배경이 투입구·선반보다 밝게 나왔다 — 재생성 대신 여기서 눌러 톤을 맞춘다
    live: true,             // P5-a G2 이식 — 고르는 것이 칸이 아니라 투입구다
    seed: 20260828,
    entry: "stage-drop-chute.png",
    payload: "stage-drop-payload.png",
    field: { type: "pegs", sprite: "stage-drop-peg.png", rows: 8 },
    closed: "stage-drop-slot-full.png",
    open: "stage-drop-slot-empty.png",
    unit: "칸",
  },
  // 어둠은 그림이 아니라 층이다 — 칸이 밝기 두 벌을 갖는다(P4 §3).
  // 어둠은 `closed`(소등된 문짝) 가 갖고, 빛은 `lit`(손전등이 닿은 같은 문짝) 로 **갈아 끼운다**.
  // 필터로 밝히면 거의 검은 사진을 곱하는 셈이라 아무리 올려도 드러나지 않는다(실측).
  k4: {
    kind: "wall",
    live: true,
    dark: true,
    seed: 20260828,
    theme: "밤의 것",
    hero: "stage-dark-hero.jpg",
    bg: "stage-dark-bg.jpg",
    closed: "stage-dark-slot-closed.png",
    lit: "stage-dark-slot-lit.png",
    open: "stage-dark-slot-empty.png",
    beam: "stage-dark-beam.png",
    unit: "칸",
  },
  k3: {
    kind: "shaft",
    theme: "방송과 기록",
    hero: "stage-wire-hero.jpg",
    bg: "stage-wire-bg.jpg",
    live: true,             // P5-a G3 이식 — 고르는 것은 출발점, 따라가야 안다
    seed: 20260828,
    entry: "stage-wire-terminal.png",
    field: { type: "wires", v: "stage-wire-run-v.png", h: "stage-wire-run-h.png", rows: 8, density: 0.42 },
    closed: "stage-wire-slot-full.png",
    open: "stage-wire-slot-empty.png",
    unit: "칸",
  },
};
