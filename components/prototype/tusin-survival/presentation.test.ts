import { describe, expect, it } from 'vitest';
import type { RuntimeSnapshot } from './runtime';
import {
  createCombatPresentation,
  type CombatPresentationSettings,
} from './presentation';
import { createRuntime } from './runtime';

const FULL_EFFECTS: CombatPresentationSettings = {
  blood: true,
  damageNumbers: true,
  flashes: true,
  reducedMotion: false,
  shake: true,
};

function runtimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    seed: 'presentation-seed',
    mode: 'RUNNING',
    tick: 10,
    stageTick: 10,
    bossFightTicks: 0,
    player: {
      id: 1,
      x: 5_000,
      y: 5_000,
      radius: 250,
      hp: 100,
      maxHp: 100,
      level: 1,
      xp: 0,
      xpToNext: 7,
      facingX: 1,
      facingY: 0,
      invulnerableTicks: 0,
    },
    enemies: [],
    projectiles: [],
    pickups: [],
    vfx: [],
    offers: [],
    chest: null,
    build: { actives: [], passives: [], evolutions: [] },
    score: {
      rawScore: 0,
      kills: 0,
      bossSplitTicks: null,
      bosses: [],
      weaponDamage: {},
    },
    debug: { active: false, invincible: false, timeScale: 1 },
    metrics: { enemyCount: 0, projectileCount: 0, pickupCount: 0 },
    ...overrides,
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

describe('combat presentation controller', () => {
  it('HP delta를 실제 피해 숫자와 단일 타격 cue로 만들고 중복 소비하지 않는다', () => {
    const controller = createCombatPresentation();
    const enemy = {
      id: 20,
      enemyId: 'demon-scout',
      role: 'NORMAL' as const,
      x: 5_600,
      y: 5_000,
      radius: 180,
      hp: 100,
      maxHp: 100,
    };
    const previous = runtimeSnapshot({ enemies: [enemy] });
    const current = runtimeSnapshot({
      tick: 11,
      stageTick: 11,
      enemies: [{ ...enemy, hp: 63 }],
      vfx: [{
        id: 90,
        kind: 'HIT',
        weaponId: 'basic-sword-strike',
        x: enemy.x,
        y: enemy.y,
        radius: 220,
        ttlTicks: 8,
      }],
    });

    const firstCues = controller.consume(previous, current, 1_000);
    const secondCues = controller.consume(previous, current, 1_001);
    const frame = controller.sample(1_010, FULL_EFFECTS);

    expect(firstCues).toEqual([
      expect.objectContaining({ kind: 'impact', weaponId: 'basic-sword-strike' }),
    ]);
    expect(secondCues).toEqual([]);
    expect(frame.damageNumbers).toEqual([
      expect.objectContaining({ damage: 37, enemyId: 20 }),
    ]);
    expect(frame.enemyHits).toEqual([
      expect.objectContaining({ enemyId: 20 }),
    ]);
  });

  it('무득점 일괄 despawn은 처치 연출로 오인하지 않는다', () => {
    const controller = createCombatPresentation();
    const previous = runtimeSnapshot({
      enemies: Array.from({ length: 20 }, (_, index) => ({
        id: index + 10,
        enemyId: 'demon-scout',
        role: 'NORMAL' as const,
        x: 4_000 + index * 50,
        y: 4_000,
        radius: 180,
        hp: 30,
        maxHp: 30,
      })),
    });
    const transition = runtimeSnapshot({
      tick: 11,
      stageTick: 360 * 60,
      mode: 'FINAL_TRANSITION',
    });

    expect(controller.consume(previous, transition, 2_000)).toEqual([]);
    expect(controller.sample(2_010, FULL_EFFECTS).deaths).toEqual([]);
  });

  it('같은 tick의 despawn과 처치를 HIT 위치로 구분한다', () => {
    const controller = createCombatPresentation();
    const despawned = {
      id: 10,
      enemyId: 'demon-scout',
      role: 'NORMAL' as const,
      x: 1_000,
      y: 1_000,
      radius: 180,
      hp: 30,
      maxHp: 30,
    };
    const killed = {
      ...despawned,
      id: 20,
      x: 5_600,
      y: 5_000,
    };
    const previous = runtimeSnapshot({ enemies: [despawned, killed] });
    const current = runtimeSnapshot({
      tick: 11,
      stageTick: 11,
      score: { ...previous.score, kills: 1 },
      vfx: [{
        id: 90,
        kind: 'HIT',
        weaponId: 'basic-sword-strike',
        x: killed.x,
        y: killed.y,
        radius: 220,
        ttlTicks: 8,
      }],
    });

    controller.consume(previous, current, 2_100);

    expect(controller.sample(2_110, FULL_EFFECTS).deaths).toEqual([
      expect.objectContaining({ enemyId: killed.id, x: killed.x, y: killed.y }),
    ]);
  });

  it('debug 최종보스 처치도 점수 변경 없이 사망 연출을 남긴다', () => {
    const controller = createCombatPresentation();
    const boss = {
      id: 90,
      enemyId: 'demon-army-vanguard',
      role: 'FINAL_BOSS' as const,
      x: 5_600,
      y: 5_000,
      radius: 620,
      hp: 22_000,
      maxHp: 22_000,
    };
    const previous = runtimeSnapshot({
      mode: 'FINAL_BOSS',
      enemies: [boss],
      debug: { active: true, invincible: false, timeScale: 1 },
    });
    const current = runtimeSnapshot({
      mode: 'RESULT_CLEAR',
      tick: 11,
      stageTick: 360 * 60,
      debug: { active: true, invincible: false, timeScale: 1 },
    });

    controller.consume(previous, current, 2_200);

    expect(controller.sample(2_210, FULL_EFFECTS).deaths).toEqual([
      expect.objectContaining({ enemyId: boss.id, role: 'FINAL_BOSS' }),
    ]);
  });

  it('밀집 tick에서도 플레이어 피격과 처치 cue를 발사음보다 우선한다', () => {
    const controller = createCombatPresentation();
    const enemy = {
      id: 20,
      enemyId: 'demon-scout',
      role: 'NORMAL' as const,
      x: 5_500,
      y: 5_000,
      radius: 180,
      hp: 30,
      maxHp: 30,
    };
    const previous = runtimeSnapshot({ enemies: [enemy] });
    const current = runtimeSnapshot({
      tick: 11,
      stageTick: 11,
      player: { ...previous.player, hp: 70 },
      score: { ...previous.score, kills: 1 },
      vfx: [
        ...Array.from({ length: 4 }, (_, index) => ({
          id: 100 + index,
          kind: 'SLASH' as const,
          weaponId: 'basic-sword-strike',
          x: previous.player.x,
          y: previous.player.y,
          radius: 300,
          ttlTicks: 8,
        })),
        {
          id: 200,
          kind: 'HIT' as const,
          weaponId: 'basic-sword-strike',
          x: enemy.x,
          y: enemy.y,
          radius: 220,
          ttlTicks: 8,
        },
      ],
    });

    const cues = controller.consume(previous, current, 2_300);

    expect(cues.map((cue) => cue.kind)).toEqual(['player-hit', 'kill', 'weapon-fire']);
  });

  it('같은 tick에 투사체가 소멸해도 HIT 위치로 공격 조준각을 복원한다', () => {
    const controller = createCombatPresentation();
    const previous = runtimeSnapshot();
    const current = runtimeSnapshot({
      tick: 11,
      stageTick: 11,
      projectiles: [],
      vfx: [
        {
          id: 81,
          kind: 'SLASH',
          weaponId: 'basic-sword-strike',
          x: previous.player.x,
          y: previous.player.y,
          radius: 300,
          ttlTicks: 8,
        },
        {
          id: 82,
          kind: 'HIT',
          weaponId: 'basic-sword-strike',
          x: previous.player.x - 300,
          y: previous.player.y,
          radius: 220,
          ttlTicks: 8,
        },
      ],
    });

    controller.consume(previous, current, 2_400);

    expect(controller.sample(2_410, FULL_EFFECTS).attacks[0]?.rotation).toBe(Math.PI);
  });

  it('플레이어 피격은 강한 카메라·플래시·오디오 피드백을 만들고 설정별로 끌 수 있다', () => {
    const controller = createCombatPresentation();
    const previous = runtimeSnapshot();
    const current = runtimeSnapshot({
      tick: 11,
      player: { ...previous.player, hp: 72, invulnerableTicks: 30 },
    });

    expect(controller.consume(previous, current, 3_000)).toEqual([
      expect.objectContaining({ kind: 'player-hit', strength: 1 }),
    ]);

    const full = controller.sample(3_010, FULL_EFFECTS);
    const reduced = controller.sample(3_010, {
      ...FULL_EFFECTS,
      flashes: false,
      reducedMotion: true,
      shake: false,
    });

    expect(Math.abs(full.camera.x) + Math.abs(full.camera.y)).toBeGreaterThan(0);
    expect(full.screenFlash).toBeGreaterThan(0);
    expect(reduced.camera).toEqual({ x: 0, y: 0 });
    expect(reduced.screenFlash).toBe(0);
  });

  it('입력 snapshot을 변경하지 않고 대량 이벤트의 표현 수를 상한 안에 둔다', () => {
    const controller = createCombatPresentation();
    const enemies = Array.from({ length: 1_000 }, (_, index) => ({
      id: index + 100,
      enemyId: 'demon-scout',
      role: 'NORMAL' as const,
      x: index * 10,
      y: index * 5,
      radius: 180,
      hp: 20,
      maxHp: 20,
    }));
    const previous = freezeDeep(runtimeSnapshot({ enemies }));
    const current = freezeDeep(runtimeSnapshot({
      tick: 11,
      enemies: enemies.map((enemy) => ({ ...enemy, hp: 10 })),
    }));

    expect(() => controller.consume(previous, current, 4_000)).not.toThrow();
    const frame = controller.sample(4_010, FULL_EFFECTS);

    expect(frame.impacts.length).toBeLessThanOrEqual(160);
    expect(frame.enemyHits.length).toBeLessThanOrEqual(160);
    expect(frame.damageNumbers.length).toBeLessThanOrEqual(80);
  });

  it('seed 또는 tick이 되감기면 이전 transient를 버린다', () => {
    const controller = createCombatPresentation();
    const previous = runtimeSnapshot();
    const hit = runtimeSnapshot({
      tick: 11,
      player: { ...previous.player, hp: 90 },
    });
    controller.consume(previous, hit, 5_000);

    controller.consume(hit, runtimeSnapshot({ seed: 'new-seed', tick: 0, stageTick: 0 }), 5_100);

    const frame = controller.sample(5_110, FULL_EFFECTS);
    expect(frame.impacts).toEqual([]);
    expect(frame.damageNumbers).toEqual([]);
    expect(frame.deaths).toEqual([]);
    expect(frame.screenFlash).toBe(0);
  });

  it('표현 계층 소비 여부가 canonical state와 command log를 바꾸지 않는다', () => {
    const observedRuntime = createRuntime('presentation-isolation');
    const controlRuntime = createRuntime('presentation-isolation');
    const controller = createCombatPresentation();
    let observed = observedRuntime.start();
    let control = controlRuntime.start();
    controller.reset(observed, 0);

    for (let tick = 0; tick < 300; tick += 1) {
      if (observed.mode === 'LEVEL_UP' && control.mode === 'LEVEL_UP') {
        observed = observedRuntime.chooseOffer(0);
        control = controlRuntime.chooseOffer(0);
        continue;
      }
      if (observed.mode === 'CHEST' && control.mode === 'CHEST') {
        observed = observedRuntime.resolveChest();
        control = controlRuntime.resolveChest();
        continue;
      }
      const previous = observed;
      observed = observedRuntime.step({ x: tick % 120 < 60 ? 1 : -1, y: 0 });
      control = controlRuntime.step({ x: tick % 120 < 60 ? 1 : -1, y: 0 });
      controller.consume(previous, observed, tick * (1_000 / 60));
      controller.sample(tick * (1_000 / 60), FULL_EFFECTS);
    }

    expect(observed).toEqual(control);
    expect(observedRuntime.getRecordedRun()).toEqual(controlRuntime.getRecordedRun());
    expect(observedRuntime.getDeterministicState()).toEqual(controlRuntime.getDeterministicState());
  });
});
