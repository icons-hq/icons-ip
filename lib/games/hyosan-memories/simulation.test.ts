import { describe, expect, it } from 'vitest';
import {
  EMPTY_HYOSAN_INPUT,
  createHyosanSimulation,
  type HyosanEncounterDefinition,
  type HyosanInputFrame,
} from './simulation';

function runTrajectory(seed: string, trajectory: readonly HyosanInputFrame[]) {
  const simulation = createHyosanSimulation({ seed, zombieCount: 24 });
  for (const input of trajectory) simulation.step(input);
  return simulation.getEventLog();
}

describe('효산의 기억 시뮬레이션', () => {
  it('같은 시드와 같은 입력 궤적은 동일한 이벤트 로그를 만든다', () => {
    const trajectory: HyosanInputFrame[] = [
      { ...EMPTY_HYOSAN_INPUT, moveY: -1 },
      { ...EMPTY_HYOSAN_INPUT, moveX: 1, moveY: -1 },
      { ...EMPTY_HYOSAN_INPUT, attackPressed: true },
      EMPTY_HYOSAN_INPUT,
      { ...EMPTY_HYOSAN_INPUT, dashPressed: true },
      EMPTY_HYOSAN_INPUT,
      { ...EMPTY_HYOSAN_INPUT, skillPressed: true },
    ];

    const first = runTrajectory('g1-cafeteria', trajectory);
    const second = runTrajectory('g1-cafeteria', trajectory);

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(28);
    expect(first.map((event) => event.type)).toContain('player_attack');
    expect(first.map((event) => event.type)).toContain('player_dashed');
    expect(first.map((event) => event.type)).toContain('skill_used');
  });

  it('근접 공격을 허용 간격 안에 잇으면 1·2·3타 콤보로 판정한다', () => {
    const encounter: HyosanEncounterDefinition = {
      player: { x: 320, y: 320 },
      zombies: [{ id: 'combo-target', x: 374, y: 320, health: 8, speed: 0 }],
    };
    const simulation = createHyosanSimulation({ seed: 'combo', encounter });

    for (const tick of [1, 9, 17]) {
      while (simulation.getSnapshot().step < tick - 1) simulation.step(EMPTY_HYOSAN_INPUT);
      simulation.step({ ...EMPTY_HYOSAN_INPUT, attackPressed: true });
    }

    const hits = simulation.getEventLog().filter((event) => event.type === 'zombie_hit');
    expect(hits).toEqual([
      { step: 1, type: 'zombie_hit', zombieId: 'combo-target', combo: 1, damage: 1 },
      { step: 9, type: 'zombie_hit', zombieId: 'combo-target', combo: 2, damage: 1 },
      { step: 17, type: 'zombie_hit', zombieId: 'combo-target', combo: 3, damage: 2 },
    ]);
    expect(simulation.getSnapshot().zombies[0]?.health).toBe(4);
  });

  it('대시 무적 중에는 접촉 피해를 무시하고 종료 직후에는 피해를 받는다', () => {
    const simulation = createHyosanSimulation({
      seed: 'dash-iframe',
      encounter: {
        player: { x: 72, y: 320 },
        zombies: [{ id: 'contact-target', x: 72, y: 320, health: 3, speed: 0 }],
      },
    });

    simulation.step({ ...EMPTY_HYOSAN_INPUT, moveX: -1, dashPressed: true });
    while (simulation.getSnapshot().step < 13) simulation.step(EMPTY_HYOSAN_INPUT);

    expect(simulation.getEventLog().filter((event) => event.type === 'player_hit')).toEqual([]);

    simulation.step(EMPTY_HYOSAN_INPUT);

    expect(simulation.getEventLog().filter((event) => event.type === 'player_hit')).toEqual([
      { step: 14, type: 'player_hit', zombieId: 'contact-target', damage: 1 },
    ]);
    expect(simulation.getSnapshot().player.health).toBe(4);
  });

  it('마지막 좀비를 처치하면 잠긴 급식실 문을 한 번만 연다', () => {
    const simulation = createHyosanSimulation({
      seed: 'room-unlock',
      encounter: {
        player: { x: 320, y: 320 },
        zombies: [{ id: 'last-zombie', x: 370, y: 320, health: 1, speed: 0 }],
      },
    });

    simulation.step({ ...EMPTY_HYOSAN_INPUT, attackPressed: true });
    simulation.step(EMPTY_HYOSAN_INPUT);

    expect(
      simulation.getEventLog().filter((event) =>
        ['zombie_defeated', 'room_cleared', 'room_unlocked'].includes(event.type)),
    ).toEqual([
      { step: 1, type: 'zombie_defeated', zombieId: 'last-zombie' },
      { step: 1, type: 'room_cleared' },
      { step: 1, type: 'room_unlocked' },
    ]);
    expect(simulation.getSnapshot().room).toEqual({
      locked: false,
      cleared: true,
      started: true,
      exited: false,
    });
  });

  it('웨이브를 정리한 뒤 열린 문을 지나 급식실 밖으로 나갈 수 있다', () => {
    const simulation = createHyosanSimulation({
      seed: 'room-exit',
      encounter: {
        player: { x: 640, y: 120 },
        zombies: [{ id: 'door-keeper', x: 690, y: 120, health: 1, speed: 0 }],
      },
    });

    simulation.step({ ...EMPTY_HYOSAN_INPUT, attackPressed: true });
    for (let step = 0; step < 30 && !simulation.getSnapshot().room.exited; step += 1) {
      simulation.step({ ...EMPTY_HYOSAN_INPUT, moveY: -1 });
    }

    expect(simulation.getSnapshot().player.y).toBeLessThan(72);
    expect(simulation.getSnapshot().room).toMatchObject({
      locked: false,
      cleared: true,
      exited: true,
    });
    expect(simulation.getEventLog().filter((event) => event.type === 'room_exited')).toEqual([
      { step: 27, type: 'room_exited' },
    ]);
  });

  it('첫 입력 전에는 웨이브와 접촉 피해를 시작하지 않는다', () => {
    const simulation = createHyosanSimulation({
      seed: 'wait-for-player',
      encounter: {
        player: { x: 320, y: 320 },
        zombies: [{ id: 'waiting-zombie', x: 320, y: 320, health: 3, speed: 2 }],
      },
    });

    for (let step = 0; step < 300; step += 1) simulation.step(EMPTY_HYOSAN_INPUT);

    expect(simulation.getSnapshot().player.health).toBe(5);
    expect(simulation.getSnapshot().room.started).toBe(false);
    expect(simulation.getEventLog().some((event) => event.type === 'player_hit')).toBe(false);
  });

  it('기본 24마리 급식실 웨이브를 이동과 3타 콤보만으로 클리어할 수 있다', () => {
    const simulation = createHyosanSimulation({ seed: 'g1-playable-room', zombieCount: 24 });

    for (let tick = 0; tick < 4_000 && simulation.getSnapshot().room.locked; tick += 1) {
      const snapshot = simulation.getSnapshot();
      const target = snapshot.zombies
        .filter((zombie) => !zombie.defeated)
        .toSorted((first, second) => {
          const firstDistance = Math.hypot(first.x - snapshot.player.x, first.y - snapshot.player.y);
          const secondDistance = Math.hypot(second.x - snapshot.player.x, second.y - snapshot.player.y);
          return firstDistance - secondDistance || first.id.localeCompare(second.id);
        })[0];
      if (!target) break;

      const x = target.x - snapshot.player.x;
      const y = target.y - snapshot.player.y;
      const distance = Math.hypot(x, y);
      simulation.step({
        ...EMPTY_HYOSAN_INPUT,
        moveX: distance > 72 ? x / distance : 0,
        moveY: distance > 72 ? y / distance : 0,
        attackPressed: distance <= 86 && tick % 7 === 0,
      });
    }

    expect(simulation.getSnapshot().room).toMatchObject({ locked: false, cleared: true });
    expect(simulation.getSnapshot().player.health).toBeGreaterThan(0);
  });
});
