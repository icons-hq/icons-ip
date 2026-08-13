import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type Box2DFactory from 'box2d-wasm';
import type { Box2DModule } from './box2d-loader';
import { RouletteSim, findWinner } from './roulette-sim';

// 노드에서는 UMD(CJS) 글루에 wasm 바이너리를 직접 주입한다(글루의 fetch 경로가
// 파일 경로를 URL로 파싱하다 실패). SIMD 글루 고정 — Node 16.4+는 항상 SIMD 지원.
const nodeRequire = createRequire(import.meta.url);

let b2: Box2DModule;

beforeAll(async () => {
  const factory = nodeRequire('box2d-wasm/dist/umd/Box2D.simd.js') as typeof Box2DFactory;
  const wasmBinary = Uint8Array.from(
    readFileSync(nodeRequire.resolve('box2d-wasm/dist/umd/Box2D.simd.wasm')),
  ).buffer;
  b2 = await factory({ wasmBinary });
});

const CONFIG = { marbleCount: 10 };

describe('roulette-sim 결정론 (c1 사전 시뮬 계약)', () => {
  it('같은 시드는 같은 우승 구슬·같은 스텝 수에 도달한다', () => {
    const first = findWinner(b2, 'seed-alpha', CONFIG);
    const second = findWinner(b2, 'seed-alpha', CONFIG);
    expect(second).toEqual(first);
  });

  it('사전 시뮬 결과가 스텝 단위 화면 재생과 일치한다', () => {
    const pre = findWinner(b2, 'seed-replay', CONFIG);
    const sim = new RouletteSim(b2, 'seed-replay', CONFIG);
    while (sim.winner === null) sim.step();
    expect(sim.winner).toBe(pre.winner);
    expect(sim.steps).toBe(pre.steps);
    sim.destroy();
  });

  it('경주가 안전 상한 안에서 자연 종결된다', () => {
    for (const seed of ['pace-1', 'pace-2', 'pace-3']) {
      const { steps } = findWinner(b2, seed, CONFIG);
      // 대형 맵: 최소 15초는 달려야 하고, 2분 안전 상한 전에 끝나야 한다
      expect(steps).toBeGreaterThan(900);
      expect(steps).toBeLessThan(7200);
    }
  });

  it('시드가 다르면 우승 구슬이 갈린다(초기 배치가 시드에 종속)', () => {
    const winners = new Set(
      ['w-1', 'w-2', 'w-3', 'w-4', 'w-5'].map((seed) => findWinner(b2, seed, CONFIG).winner),
    );
    expect(winners.size).toBeGreaterThan(1);
  });

  it('후반부(보울 이후) 선두 교체가 최소 1회 발생한다 — 역전 보증', () => {
    // 체크포인트(보울·게이트)와 디나이얼 존이 초반 선두 굳히기를 깨는지 검증.
    // 고정 시드 + 결정론이라 한 번 통과하면 코스가 바뀌지 않는 한 항상 통과한다.
    for (const seed of ['pace-1', 'pace-2', 'pace-3', 'x-1', 'x-2', 'x-3']) {
      const sim = new RouletteSim(b2, seed, CONFIG);
      let leader = -1;
      let lateChanges = 0;
      while (sim.winner === null) {
        sim.step();
        const marbles = sim.getMarbles();
        let top = 0;
        for (let i = 1; i < marbles.length; i++) {
          if (marbles[i].y > marbles[top].y) top = i;
        }
        if (leader !== top) {
          if (marbles[top].y > 38) lateChanges++;
          leader = top;
        }
      }
      expect(lateChanges, `${seed}: 후반 선두 교체 없음`).toBeGreaterThanOrEqual(1);
      sim.destroy();
    }
  });
});
