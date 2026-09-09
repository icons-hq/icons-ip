import type {
  EnemyRole,
  ProjectileKind,
  RuntimeSnapshot,
} from './runtime';
import { baseWeaponPresentationId } from './weapon-presentation';

export interface CombatPresentationSettings {
  flashes: boolean;
  shake: boolean;
  damageNumbers: boolean;
  blood: boolean;
  reducedMotion: boolean;
}

export interface AudioCue {
  id: string;
  kind: 'weapon-fire' | 'impact' | 'heavy-impact' | 'kill' | 'player-hit';
  weaponId: string | null;
  strength: number;
}

export interface PresentationImpact {
  id: string;
  weaponId: string | null;
  x: number;
  y: number;
  radius: number;
  strength: number;
  progress: number;
}

export interface PresentationEnemyHit {
  enemyId: number;
  strength: number;
  progress: number;
}

export interface PresentationDamageNumber {
  id: string;
  enemyId: number;
  x: number;
  y: number;
  damage: number;
  strength: number;
  progress: number;
}

export interface PresentationDeath {
  id: string;
  enemyId: number;
  enemyType: string;
  role: EnemyRole;
  x: number;
  y: number;
  radius: number;
  progress: number;
}

export interface PresentationTrail {
  id: string;
  projectileId: number;
  projectileKind: ProjectileKind;
  weaponId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  radius: number;
  progress: number;
}

export interface PresentationAttack {
  id: string;
  kind: 'SLASH' | 'CHAIN';
  weaponId: string | null;
  x: number;
  y: number;
  radius: number;
  rotation: number;
  progress: number;
}

export interface PresentationFrame {
  nowMs: number;
  animationMs: number;
  camera: { x: number; y: number };
  screenFlash: number;
  impacts: PresentationImpact[];
  enemyHits: PresentationEnemyHit[];
  damageNumbers: PresentationDamageNumber[];
  deaths: PresentationDeath[];
  trails: PresentationTrail[];
  attacks: PresentationAttack[];
}

export interface CombatPresentation {
  consume(previous: RuntimeSnapshot, current: RuntimeSnapshot, nowMs: number): AudioCue[];
  sample(nowMs: number, settings: CombatPresentationSettings): PresentationFrame;
  reset(snapshot: RuntimeSnapshot, nowMs?: number): void;
}

interface TimedImpact extends Omit<PresentationImpact, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedEnemyHit extends Omit<PresentationEnemyHit, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedDamageNumber extends Omit<PresentationDamageNumber, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedDeath extends Omit<PresentationDeath, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedTrail extends Omit<PresentationTrail, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedAttack extends Omit<PresentationAttack, 'progress'> {
  startedAt: number;
  durationMs: number;
}

interface TimedImpulse {
  id: string;
  startedAt: number;
  durationMs: number;
  strength: number;
}

const MAX_IMPACTS = 160;
const MAX_ENEMY_HITS = 160;
const MAX_DAMAGE_NUMBERS = 80;
const MAX_DEATHS = 48;
const MAX_TRAILS = 420;
const MAX_ATTACKS = 48;

function weaponStrength(weaponId: string | null): number {
  const base = baseWeaponPresentationId(weaponId);
  if (base === 'gram-dragon-slayer') return 1;
  if (base === 'lightning-fall' || base === 'black-dragon-chain') return 0.72;
  if (base === 'cloud-dragon-ascent') return 0.58;
  if (base === 'sword-of-light') return 0.46;
  return 0.38;
}

function progress(nowMs: number, startedAt: number, durationMs: number): number {
  return Math.min(1, Math.max(0, (nowMs - startedAt) / durationMs));
}

function active(nowMs: number, startedAt: number, durationMs: number): boolean {
  return nowMs - startedAt < durationMs;
}

function appendBounded<T>(target: T[], value: T, maximum: number) {
  target.push(value);
  if (target.length > maximum * 2) target.splice(0, target.length - maximum);
}

function trimBounded<T>(target: T[], maximum: number) {
  if (target.length > maximum) target.splice(0, target.length - maximum);
}

function hashUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function audioCuePriority(cue: AudioCue): number {
  if (cue.kind === 'player-hit') return 0;
  if (cue.kind === 'kill') return 1;
  if (cue.kind === 'heavy-impact') return 2;
  if (cue.kind === 'impact') return 3;
  return 4;
}

export function createCombatPresentation(): CombatPresentation {
  let seed: string | null = null;
  let lastTick = -1;
  let lastSampleAt: number | null = null;
  let animationMs = 0;
  let freezeUntilMs = 0;
  const consumedEventKeys = new Set<string>();
  let impacts: TimedImpact[] = [];
  let enemyHits: TimedEnemyHit[] = [];
  let damageNumbers: TimedDamageNumber[] = [];
  let deaths: TimedDeath[] = [];
  let trails: TimedTrail[] = [];
  let attacks: TimedAttack[] = [];
  let shakeImpulses: TimedImpulse[] = [];
  let flashImpulses: TimedImpulse[] = [];

  const reset = (snapshot: RuntimeSnapshot, nowMs = 0) => {
    seed = snapshot.seed;
    lastTick = snapshot.tick;
    lastSampleAt = nowMs;
    animationMs = nowMs;
    freezeUntilMs = nowMs;
    consumedEventKeys.clear();
    impacts = [];
    enemyHits = [];
    damageNumbers = [];
    deaths = [];
    trails = [];
    attacks = [];
    shakeImpulses = [];
    flashImpulses = [];
  };

  const remember = (key: string): boolean => {
    if (consumedEventKeys.has(key)) return false;
    consumedEventKeys.add(key);
    if (consumedEventKeys.size > 12_000) {
      const keys = consumedEventKeys.values();
      for (let index = 0; index < 4_000; index += 1) {
        const oldest = keys.next().value as string | undefined;
        if (!oldest) break;
        consumedEventKeys.delete(oldest);
      }
    }
    return true;
  };

  const consume = (
    previous: RuntimeSnapshot,
    current: RuntimeSnapshot,
    nowMs: number,
  ): AudioCue[] => {
    if (seed === null) reset(previous, nowMs);
    if (current.seed !== seed || current.tick < lastTick) {
      reset(current, nowMs);
      return [];
    }
    lastTick = Math.max(lastTick, current.tick);

    const cues: AudioCue[] = [];
    const previousVfxIds = new Set(previous.vfx.map((effect) => effect.id));
    const newVfx = current.vfx.filter((effect) => !previousVfxIds.has(effect.id));
    const hitEffects = newVfx.filter((effect) => effect.kind === 'HIT');
    const previousProjectiles = new Map(
      previous.projectiles.map((projectile) => [projectile.id, projectile]),
    );
    const spawnedProjectiles = current.projectiles.filter(
      (projectile) => !previousProjectiles.has(projectile.id),
    );

    for (const effect of newVfx) {
      if (effect.kind !== 'SLASH' && effect.kind !== 'CHAIN') continue;
      const eventKey = `attack:${current.tick}:${effect.id}`;
      if (!remember(eventKey)) continue;
      const aimedProjectile = spawnedProjectiles.reduce<
        RuntimeSnapshot['projectiles'][number] | null
      >((nearest, projectile) => {
        if (projectile.weaponId !== effect.weaponId) return nearest;
        if (!nearest) return projectile;
        const nearestDistance = (nearest.x - effect.x) ** 2 + (nearest.y - effect.y) ** 2;
        const distance = (projectile.x - effect.x) ** 2 + (projectile.y - effect.y) ** 2;
        return distance < nearestDistance ? projectile : nearest;
      }, null);
      const aimedHit = hitEffects.reduce<(typeof hitEffects)[number] | null>(
        (nearest, hit) => {
          if (hit.weaponId !== effect.weaponId) return nearest;
          if (!nearest) return hit;
          const nearestDistance = (nearest.x - effect.x) ** 2 + (nearest.y - effect.y) ** 2;
          const distance = (hit.x - effect.x) ** 2 + (hit.y - effect.y) ** 2;
          return distance < nearestDistance ? hit : nearest;
        },
        null,
      );
      appendBounded(attacks, {
        id: eventKey,
        kind: effect.kind,
        weaponId: effect.weaponId,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        rotation: aimedProjectile?.rotation
          ?? (aimedHit
            ? Math.atan2(aimedHit.y - effect.y, aimedHit.x - effect.x)
            : undefined)
          ?? Math.atan2(current.player.facingY, current.player.facingX),
        startedAt: nowMs,
        durationMs: effect.kind === 'CHAIN' ? 220 : 150,
      }, MAX_ATTACKS);
      cues.push({
        id: eventKey,
        kind: 'weapon-fire',
        weaponId: effect.weaponId,
        strength: weaponStrength(effect.weaponId),
      });
    }

    for (const projectile of current.projectiles) {
      const before = previousProjectiles.get(projectile.id);
      if (!before) continue;
      const deltaX = projectile.x - before.x;
      const deltaY = projectile.y - before.y;
      if (deltaX * deltaX + deltaY * deltaY < 64) continue;
      const eventKey = `trail:${current.tick}:${projectile.id}`;
      appendBounded(trails, {
        id: eventKey,
        projectileId: projectile.id,
        projectileKind: projectile.kind,
        weaponId: projectile.weaponId,
        fromX: before.x,
        fromY: before.y,
        toX: projectile.x,
        toY: projectile.y,
        radius: projectile.radius,
        startedAt: nowMs,
        durationMs: projectile.kind === 'HEAVY_PROJECTILE' ? 190 : 125,
      }, MAX_TRAILS);
    }

    const currentEnemies = new Map(current.enemies.map((enemy) => [enemy.id, enemy]));
    const removedEnemies = previous.enemies
      .filter((enemy) => !currentEnemies.has(enemy.id))
      .sort((left, right) => left.id - right.id);
    const scoredKillDelta = Math.max(0, current.score.kills - previous.score.kills);
    const terminalBossDefeats = current.mode === 'RESULT_CLEAR'
      ? removedEnemies.filter((enemy) => enemy.role === 'FINAL_BOSS').length
      : 0;
    const killDelta = Math.max(scoredKillDelta, terminalBossDefeats);
    const squaredDistanceToNearestHit = (enemy: RuntimeSnapshot['enemies'][number]) => {
      if (!hitEffects.length) return Number.POSITIVE_INFINITY;
      return hitEffects.reduce((nearest, effect) => Math.min(
        nearest,
        (effect.x - enemy.x) ** 2 + (effect.y - enemy.y) ** 2,
      ), Number.POSITIVE_INFINITY);
    };
    const killedIds = new Set(
      removedEnemies
        .sort((left, right) => (
          squaredDistanceToNearestHit(left) - squaredDistanceToNearestHit(right)
          || left.id - right.id
        ))
        .slice(0, killDelta)
        .map((enemy) => enemy.id),
    );

    const damageEvents: Array<{
      enemy: RuntimeSnapshot['enemies'][number];
      damage: number;
      killed: boolean;
    }> = [];
    for (const before of previous.enemies) {
      const after = currentEnemies.get(before.id);
      if (after && after.hp < before.hp) {
        damageEvents.push({ enemy: after, damage: before.hp - after.hp, killed: false });
      } else if (!after && killedIds.has(before.id)) {
        damageEvents.push({ enemy: before, damage: before.hp, killed: true });
      }
    }

    let strongestImpactCue: AudioCue | null = null;
    for (const event of damageEvents) {
      const eventKey = `damage:${current.tick}:${event.enemy.id}`;
      if (!remember(eventKey)) continue;
      const nearestHit = hitEffects.reduce<(typeof hitEffects)[number] | null>((best, effect) => {
        if (!best) return effect;
        const bestDistance = (best.x - event.enemy.x) ** 2 + (best.y - event.enemy.y) ** 2;
        const distance = (effect.x - event.enemy.x) ** 2 + (effect.y - event.enemy.y) ** 2;
        return distance < bestDistance ? effect : best;
      }, null);
      const weaponId = nearestHit?.weaponId ?? null;
      const strength = Math.min(1, Math.max(
        weaponStrength(weaponId),
        event.damage / Math.max(1, event.enemy.maxHp),
      ));
      appendBounded(impacts, {
        id: eventKey,
        weaponId,
        x: event.enemy.x,
        y: event.enemy.y,
        radius: Math.max(event.enemy.radius, nearestHit?.radius ?? 0),
        strength,
        startedAt: nowMs,
        durationMs: event.killed ? 240 : 150,
      }, MAX_IMPACTS);
      appendBounded(enemyHits, {
        enemyId: event.enemy.id,
        strength,
        startedAt: nowMs,
        durationMs: event.killed ? 210 : 125,
      }, MAX_ENEMY_HITS);
      appendBounded(damageNumbers, {
        id: eventKey,
        enemyId: event.enemy.id,
        x: event.enemy.x,
        y: event.enemy.y,
        damage: Math.round(event.damage),
        strength,
        startedAt: nowMs,
        durationMs: 680,
      }, MAX_DAMAGE_NUMBERS);
      appendBounded(shakeImpulses, {
        id: eventKey,
        startedAt: nowMs,
        durationMs: event.killed ? 150 : 85,
        strength: (event.killed ? 1.6 : 0.7) * strength,
      }, 80);
      if (strength >= 0.72) {
        appendBounded(flashImpulses, {
          id: eventKey,
          startedAt: nowMs,
          durationMs: 90,
          strength: 0.42 * strength,
        }, 40);
        freezeUntilMs = Math.max(freezeUntilMs, nowMs + (event.killed ? 42 : 24));
      }
      const impactCue: AudioCue = {
        id: eventKey,
        kind: event.killed ? 'kill' : strength >= 0.72 ? 'heavy-impact' : 'impact',
        weaponId,
        strength,
      };
      if (!strongestImpactCue || impactCue.strength > strongestImpactCue.strength) {
        strongestImpactCue = impactCue;
      }

      if (event.killed) {
        appendBounded(deaths, {
          id: `death:${current.tick}:${event.enemy.id}`,
          enemyId: event.enemy.id,
          enemyType: event.enemy.enemyId,
          role: event.enemy.role,
          x: event.enemy.x,
          y: event.enemy.y,
          radius: event.enemy.radius,
          startedAt: nowMs,
          durationMs: event.enemy.role === 'FINAL_BOSS' ? 900 : event.enemy.role === 'MID_BOSS' ? 520 : 320,
        }, MAX_DEATHS);
      }
    }
    if (strongestImpactCue) cues.push(strongestImpactCue);

    if (current.player.hp < previous.player.hp) {
      const eventKey = `player-hit:${current.tick}`;
      if (remember(eventKey)) {
        const strength = Math.min(1, Math.max(0.6, (previous.player.hp - current.player.hp) / 25));
        appendBounded(shakeImpulses, {
          id: eventKey,
          startedAt: nowMs,
          durationMs: 180,
          strength: 2.4 * strength,
        }, 80);
        appendBounded(flashImpulses, {
          id: eventKey,
          startedAt: nowMs,
          durationMs: 150,
          strength: 0.9 * strength,
        }, 40);
        freezeUntilMs = Math.max(freezeUntilMs, nowMs + 36);
        cues.push({ id: eventKey, kind: 'player-hit', weaponId: null, strength });
      }
    }

    trimBounded(impacts, MAX_IMPACTS);
    trimBounded(enemyHits, MAX_ENEMY_HITS);
    trimBounded(damageNumbers, MAX_DAMAGE_NUMBERS);
    trimBounded(deaths, MAX_DEATHS);
    trimBounded(trails, MAX_TRAILS);
    trimBounded(attacks, MAX_ATTACKS);
    trimBounded(shakeImpulses, 80);
    trimBounded(flashImpulses, 40);

    return cues
      .sort((left, right) => audioCuePriority(left) - audioCuePriority(right)
        || left.id.localeCompare(right.id))
      .slice(0, 3);
  };

  const sample = (
    nowMs: number,
    settings: CombatPresentationSettings,
  ): PresentationFrame => {
    if (lastSampleAt === null) {
      lastSampleAt = nowMs;
      animationMs = nowMs;
    } else {
      const elapsed = Math.max(0, nowMs - lastSampleAt);
      if (settings.reducedMotion || lastSampleAt >= freezeUntilMs) {
        animationMs += elapsed;
      } else if (nowMs > freezeUntilMs) {
        animationMs += nowMs - freezeUntilMs;
      }
      lastSampleAt = nowMs;
    }

    impacts = impacts.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    enemyHits = enemyHits.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    damageNumbers = damageNumbers.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    deaths = deaths.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    trails = trails.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    attacks = attacks.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    shakeImpulses = shakeImpulses.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));
    flashImpulses = flashImpulses.filter((effect) => active(nowMs, effect.startedAt, effect.durationMs));

    let cameraX = 0;
    let cameraY = 0;
    if (settings.shake && !settings.reducedMotion) {
      for (const impulse of shakeImpulses) {
        const envelope = 1 - progress(nowMs, impulse.startedAt, impulse.durationMs);
        const phase = hashUnit(impulse.id) * Math.PI * 2;
        const amplitude = Math.min(8, impulse.strength * 3.2) * envelope;
        cameraX += Math.sin(nowMs * 0.089 + phase) * amplitude;
        cameraY += Math.cos(nowMs * 0.113 + phase * 1.7) * amplitude;
      }
      cameraX = Math.max(-9, Math.min(9, cameraX));
      cameraY = Math.max(-9, Math.min(9, cameraY));
    }

    const screenFlash = settings.flashes
      ? Math.min(0.82, flashImpulses.reduce((maximum, impulse) => {
        const envelope = 1 - progress(nowMs, impulse.startedAt, impulse.durationMs);
        return Math.max(maximum, impulse.strength * envelope);
      }, 0))
      : 0;

    return {
      nowMs,
      animationMs,
      camera: { x: cameraX, y: cameraY },
      screenFlash,
      impacts: impacts.map((effect) => ({
        id: effect.id,
        weaponId: effect.weaponId,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        strength: effect.strength,
        progress: progress(nowMs, effect.startedAt, effect.durationMs),
      })),
      enemyHits: enemyHits.map((effect) => ({
        enemyId: effect.enemyId,
        strength: effect.strength,
        progress: progress(nowMs, effect.startedAt, effect.durationMs),
      })),
      damageNumbers: settings.damageNumbers
        ? damageNumbers.map((effect) => ({
          id: effect.id,
          enemyId: effect.enemyId,
          x: effect.x,
          y: effect.y,
          damage: effect.damage,
          strength: effect.strength,
          progress: progress(nowMs, effect.startedAt, effect.durationMs),
        }))
        : [],
      deaths: deaths.map((effect) => ({
        id: effect.id,
        enemyId: effect.enemyId,
        enemyType: effect.enemyType,
        role: effect.role,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        progress: progress(nowMs, effect.startedAt, effect.durationMs),
      })),
      trails: settings.reducedMotion
        ? []
        : trails.map((effect) => ({
          id: effect.id,
          projectileId: effect.projectileId,
          projectileKind: effect.projectileKind,
          weaponId: effect.weaponId,
          fromX: effect.fromX,
          fromY: effect.fromY,
          toX: effect.toX,
          toY: effect.toY,
          radius: effect.radius,
          progress: progress(nowMs, effect.startedAt, effect.durationMs),
        })),
      attacks: attacks.map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        weaponId: effect.weaponId,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        rotation: effect.rotation,
        progress: progress(nowMs, effect.startedAt, effect.durationMs),
      })),
    };
  };

  return { consume, sample, reset };
}
