import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { geometricTestPack } from '../packs/geometric';
import type { ContentPack } from '../packs/types';
import {
  createInteractiveRuntime,
  runRecordedCommands,
  validateReplayHeader,
  type RecordedCommand,
} from './index';

function replayFixturePack(): ContentPack {
  const pack: ContentPack = structuredClone(geometricTestPack);
  const normalId = pack.enemyArchetypes[0]!.id;
  const midboss = pack.midbosses[0]!;
  const midbossContent = pack.bossContent.midbosses[0]!;
  const finalBoss = pack.finalBoss!;
  const startingActive = pack.actives.find(
    (active) => active.id === pack.player.weaponId,
  )!;

  pack.contentVersion = 'geometric-replay-fixture-v1';
  pack.maxTicks = 200;
  pack.world = { width: 1_000, height: 1_000 };
  pack.player = {
    ...pack.player,
    startX: 500,
    startY: 500,
    moveSpeedPerTick: 20,
    pickupRadius: 1_000,
  };
  pack.characters[0]!.stats = {
    ...pack.characters[0]!.stats,
    maxHp: pack.player.maxHp,
    moveSpeedPerTick: pack.player.moveSpeedPerTick,
    pickupRadius: pack.player.pickupRadius,
  };
  pack.level.xpThresholds = Array.from({ length: 53 }, () => 1);
  pack.xpCurve.maxLevel = 54;
  pack.simulation = {
    ticksPerSecond: 60,
    stageDurationTicks: 56,
    bossFightBudgetTicks: 20,
  };
  pack.timeline = [
    {
      kind: 'wave',
      id: 'fixture-growth-wave',
      atTick: 0,
      untilTick: 53,
      cadenceTicks: 1,
      budget: 8,
      enemyIds: [normalId],
    },
    { kind: 'midboss', id: 'fixture-chest', atTick: 54, bossId: midboss.id },
    {
      kind: 'final-boss-transition',
      id: 'fixture-final-transition',
      atTick: 56,
      bossId: finalBoss.id,
    },
  ];
  pack.midbosses = [{ ...midboss, spawnTick: 54, x: 700, y: 500 }];
  pack.bossContent.midbosses = [midbossContent];
  pack.finalBoss = { ...finalBoss, spawnTick: 56, x: 700, y: 500 };
  pack.enemies = Object.fromEntries(
    Object.entries(pack.enemies).map(([id, enemy]) => [
      id,
      {
        ...enemy,
        maxHp: 1,
        moveSpeedPerTick: 0,
        contactDamage: 0,
        contactRadius: 50,
        dropXp: id === normalId ? 1 : 0,
      },
    ]),
  );
  startingActive.levels = startingActive.levels.map((level) => ({
    ...level,
    tuning: {
      ...level.tuning,
      cooldownTicks: 1,
      damage: 10,
      amount: 1,
      area: 800,
      speedPerTick: 300,
      durationTicks: 4,
      pierce: 100,
    },
  }));
  pack.weapons[pack.player.weaponId] = {
    cooldownTicks: 1,
    damage: 10,
    projectileSpeedPerTick: 300,
    projectileTtlTicks: 4,
    hitRadius: 400,
  };

  return pack;
}

function finalBossTimingFixturePack(): ContentPack {
  const pack = replayFixturePack();
  const finalBoss = pack.finalBoss!;

  pack.contentVersion = 'geometric-final-boss-timing-fixture-v1';
  pack.maxTicks = 12;
  pack.simulation = {
    ticksPerSecond: 60,
    stageDurationTicks: 2,
    bossFightBudgetTicks: 10,
  };
  pack.waves = [];
  pack.timeline = [
    {
      kind: 'final-boss-transition',
      id: 'fixture-final-transition',
      atTick: 2,
      bossId: finalBoss.id,
    },
  ];
  pack.finalBoss = { ...finalBoss, spawnTick: 2, x: 700, y: 500 };

  return pack;
}

function completeFixtureRun(pack: ContentPack, seed: string) {
  const runtime = createInteractiveRuntime(pack, seed);
  runtime.start();
  let pauseRecorded = false;

  for (let guard = 0; guard < 500; guard += 1) {
    const snapshot = runtime.getSnapshot();
    if (snapshot.mode === 'RESULT_CLEAR' || snapshot.mode === 'RESULT_LOSS') break;
    if (snapshot.mode === 'LEVEL_UP') {
      runtime.chooseOffer(0);
    } else if (snapshot.mode === 'CHEST') {
      runtime.resolveChest(0);
    } else if (snapshot.mode === 'FINAL_TRANSITION') {
      runtime.continueFinalTransition();
    } else if (snapshot.mode === 'RUNNING' || snapshot.mode === 'FINAL_BOSS') {
      if (!pauseRecorded && snapshot.tick > 0) {
        runtime.togglePause();
        runtime.togglePause();
        pauseRecorded = true;
      }
      runtime.step(snapshot.tick < 2 ? { x: 0.5001, y: 0 } : { x: 0, y: 0 });
    }
  }

  return runtime;
}

describe('shared interactive and replay seam', () => {
  it('브라우저가 기록한 모든 사용자 의도를 같은 simulation으로 replay한다', () => {
    const pack = replayFixturePack();
    const runtime = completeFixtureRun(pack, 'shared-seam-seed');
    const recording = runtime.getRecordedRun();
    const commands = recording.commands;
    const liveResult = runtime.getRunResult();
    const replay = runRecordedCommands(pack, 'shared-seam-seed', recording);

    expect(liveResult.state).toBe('RESULTS_CLEAR');
    expect(liveResult.build.actives).toHaveLength(6);
    expect(liveResult.build.passives).toHaveLength(6);
    expect(liveResult.build.evolutions.length).toBeGreaterThan(0);
    expect(new Set(commands.map((command) => command.type))).toEqual(new Set([
      'move',
      'choose-level-offer',
      'resolve-chest',
      'pause',
      'resume',
      'continue-final-transition',
    ]));
    expect(replay.result).toEqual(liveResult);
    expect(replay.status).toBe('TERMINAL');
    expect(runRecordedCommands(pack, 'shared-seam-seed', recording)).toEqual(replay);
    expect(replay.header).toMatchObject({
      replaySchemaVersion: 1,
      engineVersion: pack.engineVersion,
      contentPackId: pack.id,
      contentVersion: pack.contentVersion,
      seed: 'shared-seam-seed',
      simulationHz: 60,
      prngAlgorithmVersion: 'xorshift32-v1',
    });
    expect(replay.header.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(replay.stateDigest).toMatch(/^[0-9a-f]{8}$/);

    const changedPack = structuredClone(pack);
    changedPack.theme.colors.ground = '#abcdef';
    expect(runRecordedCommands(changedPack, 'shared-seam-seed', commands).header.contentHash)
      .not.toBe(replay.header.contentHash);
    expect(validateReplayHeader(pack, 'shared-seam-seed', replay.header)).toBe(true);
    expect(validateReplayHeader(changedPack, 'shared-seam-seed', replay.header)).toBe(false);
    expect(validateReplayHeader(pack, 'shared-seam-seed', null)).toBe(false);
  });

  it('이동 입력을 replay 정밀도로 양자화한다', () => {
    const pack = replayFixturePack();
    const recording = completeFixtureRun(pack, 'quantized-seed').getRecordedRun();
    const normalized = recording.commands.map((command): RecordedCommand => (
      command.type === 'move' && command.x === 0.5
        ? { ...command, x: 0.5004 }
        : command
    ));

    expect(runRecordedCommands(pack, 'quantized-seed', {
      ...recording,
      commands: normalized,
    })).toEqual(runRecordedCommands(pack, 'quantized-seed', recording));
  });

  it('pack의 balance budget 이후에 끝난 live run도 replay 전용 cutoff 없이 재현한다', () => {
    const pack = replayFixturePack();
    pack.maxTicks = 1;
    const runtime = completeFixtureRun(pack, 'late-finish-seed');

    expect(runtime.getSnapshot().tick).toBeGreaterThan(pack.maxTicks);
    expect(runRecordedCommands(pack, 'late-finish-seed', runtime.getRecordedRun()).result)
      .toEqual(runtime.getRunResult());
  });

  it('일반 런의 completion tick은 6분 stage와 최종보스 split의 합이다', () => {
    const pack = finalBossTimingFixturePack();
    const runtime = createInteractiveRuntime(pack, 'completion-timing-seed');
    runtime.start();

    for (let guard = 0; guard < 20; guard += 1) {
      const snapshot = runtime.getSnapshot();
      if (snapshot.mode === 'FINAL_TRANSITION') runtime.continueFinalTransition();
      else if (snapshot.mode === 'RUNNING' || snapshot.mode === 'FINAL_BOSS') runtime.step();
      else break;
    }

    const result = runtime.getRunResult();
    expect(runtime.getSnapshot().debug.active).toBe(false);
    expect(result.state).toBe('RESULTS_CLEAR');
    expect(result.bossSplitTicks).not.toBeNull();
    expect(result.completionTicks).toBe(result.stageTicks + result.bossSplitTicks!);
  });

  it('종료되지 않은 legacy command 배열은 bounded INCOMPLETE 결과로 반환한다', () => {
    const pack = replayFixturePack();
    pack.maxTicks = 1;
    pack.timeline = [];

    const replay = runRecordedCommands(pack, 'incomplete-seed', []);
    expect(replay.status).toBe('INCOMPLETE');
    expect(replay.result).toMatchObject({ state: 'RUNNING', completionTicks: 1 });
  });

  it('도형 팩이 IP 데이터 import 없이 같은 public engine seam을 실행한다', () => {
    const runtime = createInteractiveRuntime(geometricTestPack, 'geometric-runtime-seed');
    runtime.start();
    runtime.step({ x: 1, y: 0 });

    const snapshot = runtime.getSnapshot();
    const authoritativeCoordinates = [
      snapshot.player.x,
      snapshot.player.y,
      ...snapshot.enemies.flatMap((enemy) => [enemy.x, enemy.y]),
      ...snapshot.projectiles.flatMap((projectile) => [projectile.x, projectile.y]),
    ];

    expect(snapshot.build.actives[0]).toMatchObject({
      id: 'line-beam',
      name: '직선 광선',
    });
    expect(authoritativeCoordinates.every((coordinate) => (
      Number.isInteger(coordinate * 1_024)
    ))).toBe(true);

    const engineSource = readFileSync(new URL('./simulation.ts', import.meta.url), 'utf8');
    expect(engineSource).not.toMatch(
      /packs\/tusin|tusinSurvivalPack|제피르|투신전생기|DRAGON|GRAM/,
    );
  });
});
