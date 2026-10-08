import { describe, expect, it } from 'vitest';

import {
  ENDINGS,
  MAX_ENUMERATED_PATHS,
  SCENES,
  choose,
  enumerateAll,
  initialPlay,
  resolveEnding,
  sceneBeats,
  type Choice,
  type FlagKey,
} from './story';

const allChoices: Choice[] = SCENES.flatMap((scene) => scene.choices);

/** 선택 id 시퀀스를 그대로 태워서 끝 상태를 만든다. */
function play(...choiceIds: string[]) {
  let state = initialPlay();
  for (const id of choiceIds) state = choose(state, id);
  return state;
}

describe('홍실 퀘스트 서사 모델', () => {
  it('라운드마다 선택지가 정확히 3개이고 id가 전역 유일하다', () => {
    for (const scene of SCENES) expect(scene.choices, scene.id).toHaveLength(3);
    expect(new Set(allChoices.map((c) => c.id))).toHaveLength(allChoices.length);
  });

  /* 축 누적 모델의 유일한 진짜 리스크. 도달 불가 그리드 셀이 생기면 resolveEnding이
   * unreachable grid cell로 던지므로, 여기서 못 잡으면 플레이 중에 터진다. */
  it('모든 경로를 열거해도 엔딩 21종이 전부 도달 가능하다', () => {
    const enumeration = enumerateAll();

    expect(enumeration.totalPaths).toBe(3 ** SCENES.length);
    expect(enumeration.totalPaths).toBeLessThanOrEqual(MAX_ENUMERATED_PATHS);
    expect(ENDINGS).toHaveLength(21);
    expect(enumeration.unreachable.map((e) => e.id)).toEqual([]);
  });

  /* 특수 엔딩은 선언 순서대로 판정되므로 조건이 좁은 21번이 19·20을 가릴 수 있다.
   * 셋 다 실제로 열리는지는 분포로만 확인된다. */
  it('특수 엔딩 3종이 서로를 가리지 않는다', () => {
    const byId = new Map(enumerateAll().stats.map((s) => [s.ending.id, s.paths]));
    for (const id of ['read_him', 'unwish', 'swap']) {
      expect(byId.get(id), id).toBeGreaterThan(0);
    }
  });

  it('해석(read) 선택지는 정답 여부가 명시돼 있고 라운드마다 정답이 하나뿐이다', () => {
    const reads = allChoices.filter((c) => c.kind === 'read');
    expect(reads.length).toBeGreaterThan(0);
    for (const choice of reads) expect(typeof choice.correct, choice.id).toBe('boolean');

    for (const scene of SCENES) {
      const correct = scene.choices.filter((c) => c.kind === 'read' && c.correct);
      expect(correct.length, scene.id).toBeLessThanOrEqual(1);
    }
  });

  /* 원작 17화 "나를 알아차려 줄래?" 계약의 종착점. 해석 3문제를 전부 맞히고
   * 전생에서 이름의 뜻까지 말해 준 뒤 기억까지 돌려준 경로에서만 열려야 한다. */
  it('21번 엔딩은 해석 3문제를 전부 맞힌 경로에서만 열린다', () => {
    const perfect = play('r1a', 'r2c', 'r3a', 'r4b', 'r5c', 'r6c', 'r7a', 'rfa');
    const missed = play('r1a', 'r2a', 'r3a', 'r4b', 'r5c', 'r6c', 'r7a', 'rfa');

    const flags = (state: ReturnType<typeof play>) => [...state.flags] as FlagKey[];
    expect(flags(perfect)).toEqual(
      expect.arrayContaining(['read_fear', 'read_hurt', 'read_alone', 'named_him', 'remember']),
    );
    expect(resolveEnding({ axes: perfect.axes, flags: perfect.flags }).id).toBe('read_him');
    expect(flags(missed)).not.toContain('read_fear');
    expect(resolveEnding({ axes: missed.axes, flags: missed.flags }).id).not.toBe('read_him');

    const share = enumerateAll().stats.find((s) => s.ending.id === 'read_him');
    // 원작을 읽은 사람만 닿는 완주 보상이라 희소해야 한다.
    expect(share?.share).toBeLessThan(0.02);
  });

  /* 종막 플래그를 조건에 넣지 않으면 특수 엔딩이 최종 선택을 통째로 덮어쓴다.
   * 게임의 중심 결정이 무의미해지는 회귀라 못으로 박아 둔다. */
  it('특수 엔딩이 최종 선택을 덮어쓰지 않는다', () => {
    const upTo = ['r1a', 'r2c', 'r3a', 'r4b', 'r5c', 'r6c', 'r7a'] as const;
    const ids = ['rfa', 'rfb', 'rfc'].map((finale) => {
      const state = play(...upTo, finale);
      return resolveEnding({ axes: state.axes, flags: state.flags }).id;
    });
    expect(new Set(ids)).toHaveLength(3);
  });

  /* 원작 보너스 퀘스트 룰 — 실패했을 때만 열리고, 실패해도 추가 페널티가 없다. */
  it('퀘스트 실패 시에만 다음 라운드에 페널티 구간이 붙는다', () => {
    const r2 = SCENES.find((s) => s.id === 'r2');
    if (!r2?.penalty) throw new Error('R2에 페널티 구간이 없다');

    const failed = play('r1b');
    const cleared = play('r1a');

    expect(failed.flags.has('fail_r1')).toBe(true);
    expect(sceneBeats(r2, failed.flags).length).toBeGreaterThan(r2.beats.length);
    expect(sceneBeats(r2, cleared.flags)).toEqual(r2.beats);
  });

  it('종막 플래그는 항상 정확히 하나만 켜진다', () => {
    const finales = ['remember', 'release', 'restart'] as const;
    for (const id of ['rfa', 'rfb', 'rfc']) {
      const state = play('r1a', 'r2c', 'r3a', 'r4b', 'r5c', 'r6c', 'r7a', id);
      expect(finales.filter((f) => state.flags.has(f)), id).toHaveLength(1);
    }
  });
});
