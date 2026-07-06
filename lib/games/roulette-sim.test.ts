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
  const wasmBinary = readFileSync(nodeRequire.resolve('box2d-wasm/dist/umd/Box2D.simd.wasm'));
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
});
