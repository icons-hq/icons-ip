import type { PresentationFrame } from './presentation';
import type { RuntimeSnapshot } from './runtime';
import {
  combatMotionCell,
  drawAtlasCell,
  enemyMotionCell,
  finalBossMotionCell,
  pickupCell,
  playerActionCell,
  type SpriteImages,
} from './sprites';

export interface RenderSettings {
  flashes: boolean;
  shake: boolean;
  damageNumbers: boolean;
  blood: boolean;
  reducedMotion: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

interface FrameView {
  cameraX: number;
  cameraY: number;
  alpha: number;
  previous: RuntimeSnapshot;
  previousEnemies: Map<number, RuntimeSnapshot['enemies'][number]>;
  previousProjectiles: Map<number, RuntimeSnapshot['projectiles'][number]>;
}

const WORLD_TO_PIXEL = 0.16;
const FLOOR_SIZE = 560;

const EMPTY_PRESENTATION: PresentationFrame = {
  nowMs: 0,
  animationMs: 0,
  camera: { x: 0, y: 0 },
  screenFlash: 0,
  impacts: [],
  enemyHits: [],
  damageNumbers: [],
  deaths: [],
  trails: [],
  attacks: [],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function createFrameView(
  previous: RuntimeSnapshot,
  current: RuntimeSnapshot,
  alpha: number,
): FrameView {
  const boundedAlpha = clamp(alpha, 0, 1);
  return {
    cameraX: lerp(previous.player.x, current.player.x, boundedAlpha),
    cameraY: lerp(previous.player.y, current.player.y, boundedAlpha),
    alpha: boundedAlpha,
    previous,
    previousEnemies: new Map(previous.enemies.map((enemy) => [enemy.id, enemy])),
    previousProjectiles: new Map(previous.projectiles.map((projectile) => [projectile.id, projectile])),
  };
}

function onScreen(
  worldX: number,
  worldY: number,
  view: FrameView,
  viewport: Viewport,
) {
  return {
    x: viewport.width / 2 + (worldX - view.cameraX) * WORLD_TO_PIXEL,
    y: viewport.height / 2 + (worldY - view.cameraY) * WORLD_TO_PIXEL,
  };
}

function interpolatedEntityPosition(
  current: { id: number; x: number; y: number },
  previous: { id: number; x: number; y: number } | undefined,
  alpha: number,
) {
  return previous
    ? { x: lerp(previous.x, current.x, alpha), y: lerp(previous.y, current.y, alpha) }
    : { x: current.x, y: current.y };
}

function visible(x: number, y: number, radius: number, viewport: Viewport) {
  return (
    x + radius >= -96
    && y + radius >= -96
    && x - radius <= viewport.width + 96
    && y - radius <= viewport.height + 96
  );
}

function playerDirection(snapshot: RuntimeSnapshot): 'front' | 'back' | 'left' | 'right' {
  const { facingX, facingY } = snapshot.player;
  if (Math.abs(facingX) > Math.abs(facingY)) return facingX < 0 ? 'left' : 'right';
  return facingY < 0 ? 'back' : 'front';
}

function drawFloor(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  view: FrameView,
  viewport: Viewport,
) {
  const image = images['dark-cathedral-floor'];
  if (!image) throw new Error('Floor sprite image was not preloaded');
  const cameraX = view.cameraX * WORLD_TO_PIXEL;
  const cameraY = view.cameraY * WORLD_TO_PIXEL;
  const originX = -(((cameraX - viewport.width / 2) % FLOOR_SIZE) + FLOOR_SIZE) % FLOOR_SIZE;
  const originY = -(((cameraY - viewport.height / 2) % FLOOR_SIZE) + FLOOR_SIZE) % FLOOR_SIZE;

  context.fillStyle = '#07090a';
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.globalAlpha = 0.68;
  context.imageSmoothingEnabled = false;
  for (let y = originY - FLOOR_SIZE; y < viewport.height + FLOOR_SIZE; y += FLOOR_SIZE) {
    for (let x = originX - FLOOR_SIZE; x < viewport.width + FLOOR_SIZE; x += FLOOR_SIZE) {
      context.drawImage(image, x, y, FLOOR_SIZE, FLOOR_SIZE);
    }
  }
  context.globalAlpha = 1;

  const vignette = context.createRadialGradient(
    viewport.width / 2,
    viewport.height / 2,
    Math.min(viewport.width, viewport.height) * 0.14,
    viewport.width / 2,
    viewport.height / 2,
    Math.max(viewport.width, viewport.height) * 0.72,
  );
  vignette.addColorStop(0, 'rgb(8 10 11 / 0%)');
  vignette.addColorStop(1, 'rgb(0 0 0 / 64%)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, viewport.width, viewport.height);
}

function drawPickups(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  view: FrameView,
  viewport: Viewport,
  presentation: PresentationFrame,
) {
  const stride = snapshot.pickups.length > 700 ? 2 : 1;
  for (let index = 0; index < snapshot.pickups.length; index += stride) {
    const pickup = snapshot.pickups[index]!;
    const position = onScreen(pickup.x, pickup.y, view, viewport);
    const size = pickup.kind === 'CHEST' ? 48 : 21;
    if (!visible(position.x, position.y, size, viewport)) continue;
    const pulse = 1 + Math.sin((presentation.animationMs / 16.67 + pickup.id * 13) * 0.08) * 0.08;
    drawAtlasCell(
      context,
      images,
      pickupCell(pickup.kind === 'CHEST' ? 'chest' : 'xp'),
      position.x - (size * pulse) / 2,
      position.y - (size * pulse) / 2,
      size * pulse,
      size * pulse,
    );
  }
}

function enemySize(enemy: RuntimeSnapshot['enemies'][number]) {
  const worldSize = enemy.radius * 2 * WORLD_TO_PIXEL;
  if (enemy.role === 'FINAL_BOSS') return Math.max(210, worldSize * 1.05);
  if (enemy.role === 'MID_BOSS') return Math.max(116, worldSize * 1.02);
  return clamp(worldSize * 1.05, 64, 88);
}

function drawShadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 0.42,
) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = '#000';
  context.beginPath();
  context.ellipse(x, y + size * 0.31, size * 0.25, size * 0.075, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawDeathLingers(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  presentation: PresentationFrame,
  view: FrameView,
  viewport: Viewport,
  settings: RenderSettings,
) {
  for (const death of presentation.deaths) {
    const position = onScreen(death.x, death.y, view, viewport);
    const size = death.role === 'FINAL_BOSS'
      ? Math.max(220, death.radius * 2 * WORLD_TO_PIXEL)
      : death.role === 'MID_BOSS'
        ? Math.max(118, death.radius * 2 * WORLD_TO_PIXEL)
        : clamp(death.radius * 2 * WORLD_TO_PIXEL, 64, 88);
    if (!visible(position.x, position.y, size, viewport)) continue;
    const alpha = clamp(1 - death.progress * 1.12, 0, 1);
    const scale = 1 + death.progress * 0.08;
    const definition = death.role === 'FINAL_BOSS'
      ? finalBossMotionCell('death')
      : enemyMotionCell(death.enemyType, 'death');
    if (!definition) continue;
    drawAtlasCell(
      context,
      images,
      definition,
      position.x - size * scale / 2,
      position.y - size * scale * 0.58 + death.progress * 6,
      size * scale,
      size * scale,
      alpha,
    );
    if (settings.blood && death.progress < 0.72) {
      context.save();
      context.fillStyle = '#8f2f27';
      context.globalAlpha = (1 - death.progress / 0.72) * 0.72;
      for (let index = 0; index < 6; index += 1) {
        const angle = death.enemyId * 0.73 + index * 1.047;
        const distance = size * (0.12 + death.progress * (0.22 + (index % 3) * 0.05));
        const particleSize = 2 + (index % 2) * 2;
        context.fillRect(
          position.x + Math.cos(angle) * distance,
          position.y - size * 0.08 + Math.sin(angle) * distance,
          particleSize,
          particleSize,
        );
      }
      context.restore();
    }
  }
}

function drawEnemy(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  view: FrameView,
  viewport: Viewport,
  presentation: PresentationFrame,
  enemy: RuntimeSnapshot['enemies'][number],
) {
  const interpolated = interpolatedEntityPosition(
    enemy,
    view.previousEnemies.get(enemy.id),
    view.alpha,
  );
  const position = onScreen(interpolated.x, interpolated.y, view, viewport);
  const size = enemySize(enemy);
  if (!visible(position.x, position.y, size, viewport)) return;

  const hit = presentation.enemyHits.find((effect) => effect.enemyId === enemy.id);
  const hitEnvelope = hit ? Math.sin(Math.min(1, hit.progress) * Math.PI) * hit.strength : 0;
  const awayX = enemy.x - snapshot.player.x;
  const awayY = enemy.y - snapshot.player.y;
  const awayLength = Math.max(1, Math.hypot(awayX, awayY));
  const recoilX = awayX / awayLength * hitEnvelope * 7;
  const recoilY = awayY / awayLength * hitEnvelope * 4;
  const drawX = position.x + recoilX;
  const drawY = position.y + recoilY;
  drawShadow(context, drawX, drawY, size, hit ? 0.3 : 0.42);

  let definition;
  if (enemy.role === 'FINAL_BOSS') {
    const attackCycle = (presentation.animationMs + enemy.id * 71) % 1_240;
    definition = finalBossMotionCell(hit ? 'hit' : attackCycle < 240 ? 'attack' : 'idle');
  } else {
    const strideFrame = Math.floor((presentation.animationMs + enemy.id * 29) / 150) % 2;
    definition = enemyMotionCell(enemy.enemyId, hit ? 'hit' : strideFrame ? 'advance' : 'idle');
  }
  if (!definition) return;

  const squashX = 1 + hitEnvelope * 0.08;
  const squashY = 1 - hitEnvelope * 0.1;
  const bob = hit ? 0 : Math.sin((presentation.animationMs / 16.67 + enemy.id * 7) * 0.08) * 1.4;
  const flipX = enemy.role !== 'FINAL_BOSS' && enemy.x > snapshot.player.x;
  context.save();
  context.translate(drawX, drawY + bob);
  context.scale(flipX ? -1 : 1, 1);
  drawAtlasCell(
    context,
    images,
    definition,
    -size * squashX / 2,
    -size * squashY * 0.56,
    size * squashX,
    size * squashY,
  );
  context.restore();

  if (enemy.role !== 'NORMAL') {
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    const barWidth = Math.min(180, size * 0.78);
    context.fillStyle = 'rgb(0 0 0 / 78%)';
    context.fillRect(drawX - barWidth / 2, drawY + size * 0.42, barWidth, 5);
    context.fillStyle = enemy.role === 'FINAL_BOSS' ? '#cf4633' : '#b48342';
    context.fillRect(drawX - barWidth / 2, drawY + size * 0.42, barWidth * ratio, 5);
  }
}

function drawEnemies(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  view: FrameView,
  viewport: Viewport,
  presentation: PresentationFrame,
) {
  const normalEnemies = snapshot.enemies.filter((enemy) => enemy.role === 'NORMAL');
  const stride = normalEnemies.length > 900 ? Math.ceil(normalEnemies.length / 900) : 1;
  for (let index = 0; index < normalEnemies.length; index += stride) {
    drawEnemy(context, images, snapshot, view, viewport, presentation, normalEnemies[index]!);
  }
  for (const enemy of snapshot.enemies) {
    if (enemy.role !== 'NORMAL') {
      drawEnemy(context, images, snapshot, view, viewport, presentation, enemy);
    }
  }
}

function projectileDimensions(
  projectile: RuntimeSnapshot['projectiles'][number],
  baseSize: number,
) {
  switch (projectile.kind) {
    case 'CLEAVE': return { width: baseSize * 1.55, height: baseSize * 1.08, alpha: 0.94 };
    case 'PROJECTILE': return { width: baseSize * 1.45, height: baseSize * 0.78, alpha: 0.96 };
    case 'ORBIT': return { width: baseSize * 0.84, height: baseSize * 0.84, alpha: 0.98 };
    case 'HEAVY_PROJECTILE': return { width: baseSize * 1.72, height: baseSize, alpha: 1 };
    case 'CHAIN': return { width: baseSize * 1.38, height: baseSize * 0.82, alpha: 0.9 };
    case 'AURA': return { width: baseSize * 2.05, height: baseSize * 2.05, alpha: 0.58 };
  }
}

function drawTrails(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  presentation: PresentationFrame,
  view: FrameView,
  viewport: Viewport,
) {
  const stride = presentation.trails.length > 240
    ? Math.ceil(presentation.trails.length / 240)
    : 1;
  context.save();
  context.globalCompositeOperation = 'lighter';
  for (let index = 0; index < presentation.trails.length; index += stride) {
    const trail = presentation.trails[index]!;
    const definition = combatMotionCell(trail.weaponId, 'afterglow');
    if (!definition) continue;
    const alpha = (1 - trail.progress) * 0.42;
    const size = clamp(trail.radius * 2 * WORLD_TO_PIXEL * 1.05, 18, 92);
    const samples = trail.projectileKind === 'HEAVY_PROJECTILE' ? 3 : 2;
    for (let sample = 0; sample < samples; sample += 1) {
      const amount = (sample + 1) / (samples + 1);
      const position = onScreen(
        lerp(trail.fromX, trail.toX, amount),
        lerp(trail.fromY, trail.toY, amount),
        view,
        viewport,
      );
      if (!visible(position.x, position.y, size, viewport)) continue;
      drawAtlasCell(
        context,
        images,
        definition,
        position.x - size / 2,
        position.y - size / 2,
        size,
        size,
        alpha * (1 - amount * 0.32),
      );
    }
  }
  context.restore();
}

function drawProjectiles(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  view: FrameView,
  viewport: Viewport,
) {
  const stride = snapshot.projectiles.length > 1_100
    ? Math.ceil(snapshot.projectiles.length / 1_100)
    : 1;
  for (let index = 0; index < snapshot.projectiles.length; index += stride) {
    const projectile = snapshot.projectiles[index]!;
    const interpolated = interpolatedEntityPosition(
      projectile,
      view.previousProjectiles.get(projectile.id),
      view.alpha,
    );
    const position = onScreen(interpolated.x, interpolated.y, view, viewport);
    const baseSize = clamp(projectile.radius * 2 * WORLD_TO_PIXEL * 1.08, 28, 118);
    if (!visible(position.x, position.y, baseSize * 1.8, viewport)) continue;
    const phase = projectile.ttlTicks <= 3 ? 'afterglow' : 'active';
    const definition = combatMotionCell(projectile.weaponId, phase);
    if (!definition) continue;
    const dimensions = projectileDimensions(projectile, baseSize);

    context.save();
    context.translate(position.x, position.y);
    context.rotate(projectile.rotation);
    context.globalCompositeOperation = 'lighter';
    drawAtlasCell(
      context,
      images,
      definition,
      -dimensions.width * 0.58,
      -dimensions.height * 0.58,
      dimensions.width * 1.16,
      dimensions.height * 1.16,
      dimensions.alpha * 0.24,
    );
    context.globalCompositeOperation = 'source-over';
    drawAtlasCell(
      context,
      images,
      definition,
      -dimensions.width / 2,
      -dimensions.height / 2,
      dimensions.width,
      dimensions.height,
      dimensions.alpha,
    );
    context.restore();
  }
}

function drawCombatEffects(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  presentation: PresentationFrame,
  view: FrameView,
  viewport: Viewport,
  settings: RenderSettings,
) {
  for (const attack of presentation.attacks) {
    const phase = attack.progress < 0.28 ? 'startup' : attack.progress < 0.78 ? 'active' : 'afterglow';
    const definition = attack.weaponId ? combatMotionCell(attack.weaponId, phase) : null;
    if (!definition) continue;
    const position = onScreen(attack.x, attack.y, view, viewport);
    const size = clamp(attack.radius * WORLD_TO_PIXEL * 1.8, 58, 190);
    const alpha = clamp(1 - attack.progress, 0.12, 0.9);
    context.save();
    context.translate(position.x, position.y);
    if (attack.kind === 'SLASH') context.rotate(attack.rotation);
    context.globalCompositeOperation = 'lighter';
    drawAtlasCell(context, images, definition, -size / 2, -size / 2, size, size, alpha);
    context.restore();
  }

  for (const effect of presentation.impacts) {
    const definition = combatMotionCell(effect.weaponId ?? 'basic-sword-strike', 'impact');
    if (!definition) continue;
    const position = onScreen(effect.x, effect.y, view, viewport);
    const baseSize = clamp(effect.radius * 2 * WORLD_TO_PIXEL * 1.12, 44, 164);
    const scale = 0.72 + Math.sin(effect.progress * Math.PI / 2) * (0.56 + effect.strength * 0.26);
    const alpha = (1 - effect.progress) * (settings.flashes ? 0.98 : 0.58);
    const size = baseSize * scale;
    if (!visible(position.x, position.y, size, viewport)) continue;
    context.save();
    context.globalCompositeOperation = 'lighter';
    drawAtlasCell(
      context,
      images,
      definition,
      position.x - size / 2,
      position.y - size / 2,
      size,
      size,
      alpha,
    );
    context.restore();
  }

  for (const effect of snapshot.vfx) {
    if (effect.kind !== 'BOSS_WARNING') continue;
    const position = onScreen(effect.x, effect.y, view, viewport);
    const life = clamp(effect.ttlTicks / 30, 0, 1);
    const radius = Math.max(36, effect.radius * WORLD_TO_PIXEL * (1.5 - life * 0.3));
    context.save();
    context.globalAlpha = life * 0.72;
    context.strokeStyle = '#cf4633';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}

function playerPose(
  snapshot: RuntimeSnapshot,
  previous: RuntimeSnapshot,
  presentation: PresentationFrame,
  attack: PresentationFrame['attacks'][number] | undefined,
): 'idle' | 'runContact' | 'runPassing' | 'anticipation' | 'impact' | 'recovery' {
  if (attack) {
    if (attack.progress < 0.24) return 'anticipation';
    if (attack.progress < 0.62) return 'impact';
    return 'recovery';
  }
  const moving = Math.hypot(
    snapshot.player.x - previous.player.x,
    snapshot.player.y - previous.player.y,
  ) > 0.1;
  if (!moving) return 'idle';
  return Math.floor(presentation.animationMs / 92) % 2 ? 'runPassing' : 'runContact';
}

function directionFromRotation(rotation: number): 'front' | 'back' | 'left' | 'right' {
  const x = Math.cos(rotation);
  const y = Math.sin(rotation);
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'back' : 'front';
}

function drawPlayer(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  previous: RuntimeSnapshot,
  viewport: Viewport,
  presentation: PresentationFrame,
) {
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  const size = clamp(Math.min(viewport.width, viewport.height) * 0.12, 86, 116);
  const invulnerableAlpha = snapshot.player.invulnerableTicks > 0
    && Math.floor(presentation.animationMs / 55) % 2
    ? 0.48
    : 1;
  const attack = [...presentation.attacks].reverse().find((effect) => (
    Math.hypot(effect.x - snapshot.player.x, effect.y - snapshot.player.y) < 600
  ));
  const direction = attack ? directionFromRotation(attack.rotation) : playerDirection(snapshot);

  drawShadow(context, x, y, size, 0.54);
  drawAtlasCell(
    context,
    images,
    playerActionCell(direction, playerPose(snapshot, previous, presentation, attack)),
    x - size / 2,
    y - size * 0.58,
    size,
    size,
    invulnerableAlpha,
  );

  context.save();
  context.strokeStyle = 'rgb(97 217 220 / 46%)';
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(x, y + size * 0.28, size * 0.29, size * 0.09, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawDamageNumbers(
  context: CanvasRenderingContext2D,
  presentation: PresentationFrame,
  view: FrameView,
  viewport: Viewport,
) {
  for (const effect of presentation.damageNumbers) {
    const position = onScreen(effect.x, effect.y, view, viewport);
    if (!visible(position.x, position.y, 80, viewport)) continue;
    const punch = effect.progress < 0.16
      ? 0.72 + effect.progress / 0.16 * 0.58
      : 1 - (effect.progress - 0.16) * 0.12;
    const fade = effect.progress > 0.64 ? (1 - effect.progress) / 0.36 : 1;
    const y = position.y - 14 - effect.progress * (22 + effect.strength * 14);
    const fontSize = Math.round(13 + effect.strength * 7);
    context.save();
    context.translate(position.x + 5, y);
    context.scale(punch, punch);
    context.globalAlpha = clamp(fade, 0, 1);
    context.fillStyle = effect.strength > 0.72 ? '#fff4bd' : '#f1e5cb';
    context.strokeStyle = '#050505';
    context.lineWidth = 4;
    context.font = `800 ${fontSize}px system-ui`;
    context.textAlign = 'center';
    const label = Math.max(1, effect.damage).toLocaleString('ko-KR');
    context.strokeText(label, 0, 0);
    context.fillText(label, 0, 0);
    context.restore();
  }
}

export function renderRuntimeFrame(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
  settings: RenderSettings,
  presentation: PresentationFrame = EMPTY_PRESENTATION,
  previousSnapshot: RuntimeSnapshot = snapshot,
  interpolationAlpha = 1,
) {
  const view = createFrameView(previousSnapshot, snapshot, interpolationAlpha);
  const bossWarningShake = settings.shake
    && !settings.reducedMotion
    && snapshot.vfx.some((effect) => effect.kind === 'BOSS_WARNING')
    ? 3
    : 0;
  const warningX = bossWarningShake ? Math.sin(snapshot.tick * 2.17) * bossWarningShake : 0;
  const warningY = bossWarningShake ? Math.cos(snapshot.tick * 1.71) * bossWarningShake : 0;

  context.save();
  context.translate(
    presentation.camera.x + warningX,
    presentation.camera.y + warningY,
  );
  drawFloor(context, images, view, viewport);
  drawPickups(context, images, snapshot, view, viewport, presentation);
  drawDeathLingers(context, images, presentation, view, viewport, settings);
  drawTrails(context, images, presentation, view, viewport);
  drawEnemies(context, images, snapshot, view, viewport, presentation);
  drawProjectiles(context, images, snapshot, view, viewport);
  drawCombatEffects(context, images, snapshot, presentation, view, viewport, settings);
  drawPlayer(context, images, snapshot, previousSnapshot, viewport, presentation);
  drawDamageNumbers(context, presentation, view, viewport);
  context.restore();

  if (presentation.screenFlash > 0) {
    context.fillStyle = `rgb(255 244 218 / ${Math.round(presentation.screenFlash * 46)}%)`;
    context.fillRect(0, 0, viewport.width, viewport.height);
  }

  if (snapshot.mode === 'PAUSED' || snapshot.mode === 'LEVEL_UP' || snapshot.mode === 'CHEST') {
    context.fillStyle = 'rgb(1 2 3 / 26%)';
    context.fillRect(0, 0, viewport.width, viewport.height);
  }
}
