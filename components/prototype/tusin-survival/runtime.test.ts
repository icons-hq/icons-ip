import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runRecordedCommands } from '@/lib/prototypes/tusin-survival/engine';
import { tusinSurvivalPack } from '@/lib/prototypes/tusin-survival/packs/tusin';
import { createRuntime } from './runtime';

describe('interactive Tusin Survival runtime', () => {
  it('결과 화면은 기록 경계까지 terminal replay된 run만 검증 완료로 처리한다', () => {
    const canvasSource = readFileSync(
      new URL('./SurvivalCanvas.tsx', import.meta.url),
      'utf8',
    );

    expect(canvasSource).toContain('runtime.getRecordedRun()');
    expect(canvasSource).toContain("outcome.status === 'TERMINAL'");
    expect(canvasSource).toContain('resultMode && resultOverlayReady');
    expect(canvasSource).toContain('resultMode && !resultOverlayReady');
  });

  it('브라우저 composition root가 공용 engine command log와 같은 결과를 만든다', () => {
    const runtime = createRuntime('browser-replay-seam-seed');
    runtime.start();

    for (let tick = 0; tick < 2_400 && runtime.getSnapshot().mode === 'RUNNING'; tick += 1) {
      runtime.step({ x: tick < 30 ? 0.5001 : 0, y: 0 });
    }

    expect(runtime.getSnapshot().mode).not.toBe('RUNNING');
    expect(runRecordedCommands(
      tusinSurvivalPack,
      'browser-replay-seam-seed',
      runtime.getRecordedRun(),
    ).result).toEqual(runtime.getRunResult());
  });

  it('XP를 얻으면 simulation을 멈추고 서로 다른 세 개의 성장 후보를 제시한다', () => {
    const runtime = createRuntime('level-offer-seed');
    runtime.start();

    runtime.debugGrantXp(10_000);
    const snapshot = runtime.getSnapshot();

    expect(snapshot.mode).toBe('LEVEL_UP');
    expect(snapshot.offers).toHaveLength(3);
    expect(new Set(snapshot.offers.map((offer) => offer.id)).size).toBe(3);

    const frozenTick = snapshot.stageTick;
    runtime.step({ x: 1, y: 0 });
    expect(runtime.getSnapshot().stageTick).toBe(frozenTick);

    runtime.chooseOffer(0);
    expect(runtime.getSnapshot().build.actives.length + runtime.getSnapshot().build.passives.length)
      .toBeGreaterThan(1);
  });

  it('레벨업에 사용한 XP를 차감하고 다음 threshold 전에는 연속 선택을 열지 않는다', () => {
    const runtime = createRuntime('xp-consumption-seed');
    runtime.start();

    runtime.debugGrantXp(7);
    expect(runtime.getSnapshot()).toMatchObject({
      mode: 'LEVEL_UP',
      player: { level: 2, xp: 0 },
    });

    runtime.chooseOffer(0);
    expect(runtime.getSnapshot()).toMatchObject({
      mode: 'RUNNING',
      player: { level: 2, xp: 0 },
    });
  });

  it('active/passive 슬롯과 레벨 상한을 지키고 상자에서 대응 조합을 진화시킨다', () => {
    const runtime = createRuntime('slot-and-evolution-seed');
    runtime.start();
    runtime.debugGrantXp(1_000_000);

    for (let choice = 0; choice < 53 && runtime.getSnapshot().mode === 'LEVEL_UP'; choice += 1) {
      const { offers, build } = runtime.getSnapshot();
      const sword = build.actives.find((item) => item.id === 'basic-sword-strike');
      const priorityId = sword?.level !== 5
        ? 'basic-sword-strike'
        : build.passives.some((item) => item.id === 'wall-of-iron')
          ? null
          : 'wall-of-iron';
      const index = priorityId ? offers.findIndex((offer) => offer.id === priorityId) : -1;
      runtime.chooseOffer(index >= 0 ? index : 0);
    }

    const fullBuild = runtime.getSnapshot().build;
    expect(fullBuild.actives.length).toBeLessThanOrEqual(6);
    expect(fullBuild.passives.length).toBeLessThanOrEqual(6);
    expect(fullBuild.actives.every((item) => item.level <= 5)).toBe(true);
    expect(fullBuild.passives.every((item) => item.level <= 3)).toBe(true);
    expect(fullBuild.actives.find((item) => item.id === 'basic-sword-strike')?.level).toBe(5);
    expect(fullBuild.passives.some((item) => item.id === 'wall-of-iron')).toBe(true);

    runtime.debugSpawnChest();
    expect(runtime.getSnapshot().chest?.eligibleEvolutionIds).toContain('iron-wall-sword-path');
    runtime.resolveChest();

    const evolvedBuild = runtime.getSnapshot().build;
    expect(evolvedBuild.evolutions.map((item) => item.id)).toContain('iron-wall-sword-path');
    expect(evolvedBuild.actives.find((item) => item.id === 'basic-sword-strike')?.evolvedInto)
      .toBe('iron-wall-sword-path');
  });

  it('6:00에 일반 적을 무득점 정리하고 최종보스 전환을 거친다', () => {
    const runtime = createRuntime('final-transition-seed');
    runtime.start();
    runtime.step();

    expect(runtime.getSnapshot().enemies.some((enemy) => enemy.role === 'NORMAL')).toBe(true);
    const scoreBeforeTransition = runtime.getSnapshot().score.rawScore;

    runtime.debugJumpToStageTick(6 * 60 * 60 - 1);
    runtime.step();

    const transition = runtime.getSnapshot();
    expect(transition.mode).toBe('FINAL_TRANSITION');
    expect(transition.stageTick).toBe(6 * 60 * 60);
    expect(transition.enemies.some((enemy) => enemy.role === 'NORMAL')).toBe(false);
    expect(transition.pickups.some((pickup) => pickup.kind === 'XP')).toBe(false);
    expect(transition.score.rawScore).toBe(scoreBeforeTransition);

    runtime.continueFinalTransition();
    const fight = runtime.getSnapshot();
    expect(fight.mode).toBe('FINAL_BOSS');
    expect(fight.enemies.filter((enemy) => enemy.role === 'FINAL_BOSS')).toHaveLength(1);
  });

  it('6:00 도달만으로 clear하지 않고 최종보스를 처치했을 때만 clear한다', () => {
    const runtime = createRuntime('final-clear-seed');
    runtime.start();
    runtime.debugJumpToStageTick(6 * 60 * 60 - 1);
    runtime.step();
    runtime.continueFinalTransition();

    const beforeKill = runtime.getSnapshot();
    expect(beforeKill.mode).toBe('FINAL_BOSS');
    expect(beforeKill.score.bossSplitTicks).toBeNull();

    const finalBoss = beforeKill.enemies.find((enemy) => enemy.role === 'FINAL_BOSS')!;
    runtime.debugDamageEnemy(finalBoss.id, finalBoss.maxHp);

    const clear = runtime.getSnapshot();
    expect(clear.mode).toBe('RESULT_CLEAR');
    expect(clear.score.bossSplitTicks).toBe(0);
    expect(clear.score.bosses.find((boss) => boss.role === 'FINAL_BOSS')?.killTick)
      .toBe(clear.tick);
    expect(clear.score.rawScore).toBe(0);
  });

  it('같은 seed와 이동 입력은 같은 snapshot을 만들고 다른 seed는 spawn을 바꾼다', () => {
    const first = createRuntime('deterministic-seed');
    const replay = createRuntime('deterministic-seed');
    const other = createRuntime('other-seed');
    first.start();
    replay.start();
    other.start();

    for (let tick = 0; tick < 90; tick += 1) {
      const intent = tick < 45 ? { x: 1, y: -0.25 } : { x: -0.5, y: 1 };
      first.step(intent);
      replay.step(intent);
      other.step(intent);
    }

    expect(first.getSnapshot()).toEqual(replay.getSnapshot());
    expect(first.getSnapshot().enemies.map(({ x, y }) => ({ x, y })))
      .not.toEqual(other.getSnapshot().enemies.map(({ x, y }) => ({ x, y })));
  });

  it('보유한 여섯 active가 서로 구분되는 자동공격 형태를 발사한다', () => {
    const runtime = createRuntime('six-weapons-seed');
    runtime.start();
    runtime.setDebug({ invincible: true });
    runtime.debugGrantXp(1_000_000);

    for (let choice = 0; choice < 53 && runtime.getSnapshot().mode === 'LEVEL_UP'; choice += 1) {
      const offers = runtime.getSnapshot().offers;
      const index = offers.findIndex((offer) => offer.kind === 'ACTIVE' && offer.newSlot);
      runtime.chooseOffer(index >= 0 ? index : 0);
    }
    expect(runtime.getSnapshot().build.actives).toHaveLength(6);

    const observed = new Set<string>();
    for (let tick = 0; tick < 360; tick += 1) {
      const snapshot = runtime.step();
      for (const projectile of snapshot.projectiles) observed.add(projectile.kind);
    }

    expect(observed).toEqual(new Set([
      'CLEAVE',
      'PROJECTILE',
      'ORBIT',
      'HEAVY_PROJECTILE',
      'CHAIN',
      'AURA',
    ]));
  });

  it('2:00과 4:00에 서로 다른 중간보스 milestone을 생성한다', () => {
    const runtime = createRuntime('midboss-timeline-seed');
    runtime.start();
    runtime.setDebug({ invincible: true });

    runtime.debugJumpToStageTick(2 * 60 * 60 - 1);
    runtime.step();
    expect(runtime.getSnapshot().score.bosses).toContainEqual(expect.objectContaining({
      id: 'midboss-abyss-captain',
      spawnTick: 2 * 60 * 60,
    }));

    runtime.debugJumpToStageTick(4 * 60 * 60 - 1);
    runtime.step();
    expect(runtime.getSnapshot().score.bosses).toContainEqual(expect.objectContaining({
      id: 'midboss-siege-mage',
      spawnTick: 4 * 60 * 60,
    }));
  });

  it('pause는 tick을 멈추고 time scale은 호출당 고정 tick 수만 진행한다', () => {
    const runtime = createRuntime('debug-controls-seed');
    runtime.start();
    runtime.setDebug({ invincible: true, timeScale: 4 });
    runtime.step({ x: 1, y: 0 });
    expect(runtime.getSnapshot()).toMatchObject({
      stageTick: 4,
      debug: { active: true, invincible: true, timeScale: 4 },
    });

    runtime.togglePause();
    const paused = runtime.getSnapshot();
    expect(paused.mode).toBe('PAUSED');
    runtime.step({ x: 1, y: 0 });
    expect(runtime.getSnapshot().stageTick).toBe(paused.stageTick);

    runtime.togglePause();
    runtime.step();
    expect(runtime.getSnapshot().stageTick).toBe(paused.stageTick + 4);
  });

  it('desktop과 mobile 렌더 예산을 검증할 수 있는 판정 유지 stress scene을 만든다', () => {
    const runtime = createRuntime('stress-scene-seed');
    runtime.start();

    runtime.debugPopulateStress(1_000, 1_500);
    expect(runtime.getSnapshot()).toMatchObject({
      debug: { active: true, invincible: true },
      metrics: { enemyCount: 1_000, projectileCount: 1_500 },
    });

    runtime.step({ x: 1, y: 0 });
    expect(runtime.getSnapshot().mode).toBe('RUNNING');
  });

  it('자동공격의 실제 피해와 처치 점수는 simulation event에서 누적된다', () => {
    const runtime = createRuntime('score-and-damage-seed');
    runtime.start();

    for (let tick = 0; tick < 900 && runtime.getSnapshot().score.kills === 0; tick += 1) {
      runtime.step();
    }

    const result = runtime.getSnapshot();
    expect(result.score.kills).toBeGreaterThan(0);
    expect(result.score.rawScore).toBeGreaterThan(0);
    expect(result.score.weaponDamage['basic-sword-strike']).toBeGreaterThan(0);
  });
});
