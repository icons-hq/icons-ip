/* 무대 스냅 보조(스크롤 연출 계약 v1 §3 C안 정정 · 2026-09-07)
 *
 * CSS `scroll-snap-type: proximity` 는 화면 시작점 0.2~0.33 화면 안에서 손을 떼면 시작점으로 되당긴다(실측) —
 * 예산이 1.6 인 화면의 스크럽 구간(0.6 화면) 절반이 되당김에 먹힌다. 그래서 CSS 스냅은 끄고,
 * **전환 구간에서만** 붙잡는다: 화면 k 의 스크럽 끝(top_k + H_k − vh)과 다음 화면 시작(top_k+1) 사이에 멈추면
 * 가까운 쪽으로 보낸다. 스크럽 구간 안(top_k ~ 스크럽 끝)에서는 손을 놓는다 — 그게 스크롤 거리가 시간축이 되는 조건이다.
 *
 * 순수 함수 — 화면을 모른다. 검증은 scripts/test-scroll-grammar.mjs ⑦.
 */
export function snapTargetFor(y, tops, heights, vh) {
  for (let k = 0; k + 1 < tops.length; k++) {
    const scrubEnd = tops[k] + Math.max(0, heights[k] - vh);
    const next = tops[k + 1];
    if (y > scrubEnd + 1 && y < next - 1) return y - scrubEnd < next - y ? scrubEnd : next;
  }
  return null;
}
