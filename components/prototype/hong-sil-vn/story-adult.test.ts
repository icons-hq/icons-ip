import { afterEach, describe, expect, it } from 'vitest';

import { ADULT_BEATS, ADULT_GAP_COUNT, ADULT_SCENE_IDS } from './story-adult';
import {
  ADULT_TRACK_SUMMARY,
  ENDINGS,
  NEVER_ADULT,
  SCENES,
  choose,
  clearAdultTrack,
  enumerateAll,
  initialPlay,
  registerAdultTrack,
  resolveEnding,
  sceneBeats,
} from './story';

const sceneById = (id: string) => {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`없는 씬: ${id}`);
  return scene;
};

afterEach(() => clearAdultTrack());

describe('성인 트랙', () => {
  /* 미성년자가 등장하는 라운드는 어떤 트랙에서도 확장하지 않는다.
   * 실수로 추가되면 등록 자체가 실패해야 한다. */
  it('미성년 등장 라운드는 확장 대상에서 제외된다', () => {
    for (const id of NEVER_ADULT) {
      expect(ADULT_BEATS, id).not.toHaveProperty(id);
    }
    expect(() => registerAdultTrack({ ...ADULT_BEATS, r3: [] })).toThrow(/r3/);
  });

  it('확장 대상 라운드가 전부 실제 씬이다', () => {
    const known = new Set(SCENES.map((s) => s.id));
    for (const id of ADULT_SCENE_IDS) expect(known.has(id), id).toBe(true);
  });

  /* 게이트 화면은 청크를 받기 전에 규모를 보여 준다 — 그 숫자가 실제와 어긋나면 안 된다. */
  it('게이트가 안내하는 규모가 실제 확장본과 맞는다', () => {
    expect(ADULT_TRACK_SUMMARY.scenes).toBe(ADULT_SCENE_IDS.length);
    expect(ADULT_TRACK_SUMMARY.gaps).toBe(ADULT_GAP_COUNT);
  });

  /* 정사 구간은 본문이 아니라 슬롯으로 남는다 — 확장본마다 정확히 하나씩 있어야 한다. */
  it('확장본마다 집필 슬롯이 정확히 하나씩 있다', () => {
    for (const [id, beats] of Object.entries(ADULT_BEATS)) {
      const gaps = beats.filter((b) => b.kind === 'gap');
      expect(gaps, id).toHaveLength(1);
      for (const gap of gaps) {
        if (gap.kind !== 'gap') throw new Error('unreachable');
        expect(gap.note.length, id).toBeGreaterThan(10);
      }
    }
  });

  it('등록 전에는 성인 트랙을 요청해도 전연령 비트가 나온다', () => {
    const scene = sceneById('r5');
    expect(sceneBeats(scene, new Set(), 'adult')).toEqual(scene.beats);
  });

  it('등록 후에는 확장 대상만 바뀌고 나머지는 그대로다', () => {
    registerAdultTrack(ADULT_BEATS);

    const r5 = sceneById('r5');
    expect(sceneBeats(r5, new Set(), 'adult')).not.toEqual(r5.beats);
    expect(sceneBeats(r5, new Set(), 'all-ages')).toEqual(r5.beats);

    // 확장본이 없는 라운드는 두 트랙이 같아야 한다
    const r1 = sceneById('r1');
    expect(sceneBeats(r1, new Set(), 'adult')).toEqual(r1.beats);
  });

  /* 페널티 구간은 트랙과 직교한다 — 성인 트랙에서도 실패하면 똑같이 붙어야 한다. */
  it('성인 트랙에서도 페널티 구간이 앞에 붙는다', () => {
    registerAdultTrack(ADULT_BEATS);
    const r6 = sceneById('r6');
    if (!r6.penalty) throw new Error('R6에 페널티 구간이 없다');

    const failed = new Set(['fail_r4' as const]);
    const withPenalty = sceneBeats(r6, failed, 'adult');
    const withoutPenalty = sceneBeats(r6, new Set(), 'adult');

    expect(withPenalty).toHaveLength(r6.penalty.beats.length + withoutPenalty.length);
    expect(withPenalty.slice(0, r6.penalty.beats.length)).toEqual(r6.penalty.beats);
  });

  /* 트랙은 비트만 갈아 끼운다. 축·플래그·엔딩 판정은 공유하므로
   * 같은 선택 시퀀스는 트랙과 무관하게 같은 엔딩에 닿아야 한다. */
  it('트랙을 바꿔도 엔딩 판정이 달라지지 않는다', () => {
    const seq = ['r1a', 'r2c', 'r3a', 'r4b', 'r5c', 'r6c', 'r7a', 'rfa'];
    const run = () => {
      let state = initialPlay();
      for (const id of seq) state = choose(state, id);
      return resolveEnding({ axes: state.axes, flags: state.flags }).id;
    };

    const allAges = run();
    registerAdultTrack(ADULT_BEATS);
    expect(run()).toBe(allAges);
  });

  it('성인 트랙 전용 엔딩은 없다', () => {
    const before = enumerateAll();
    registerAdultTrack(ADULT_BEATS);
    const after = enumerateAll();

    expect(after.totalPaths).toBe(before.totalPaths);
    expect(after.stats.length).toBe(ENDINGS.length);
  });

  /* 확장본은 원래 씬과 같은 지점에서 끝나야 이어지는 prompt·선택지가 성립한다. */
  it('확장본이 원래 씬과 같은 마지막 비트로 끝난다', () => {
    for (const [id, beats] of Object.entries(ADULT_BEATS)) {
      const scene = sceneById(id);
      expect(beats.at(-1), id).toEqual(scene.beats.at(-1));
    }
  });
});
