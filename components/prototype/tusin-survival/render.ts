import type { RuntimeSnapshot } from './runtime';
import {
  drawAtlasCell,
  drawFullImage,
  enemyCell,
  pickupCell,
  playerCell,
  vfxCell,
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

const WORLD_TO_PIXEL = 0.16;
const FLOOR_SIZE = 560;

function onScreen(
  worldX: number,
  worldY: number,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  return {
    x: viewport.width / 2 + (worldX - snapshot.player.x) * WORLD_TO_PIXEL,
    y: viewport.height / 2 + (worldY - snapshot.player.y) * WORLD_TO_PIXEL,
  };
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
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  const image = images['dark-cathedral-floor'];
  const cameraX = snapshot.player.x * WORLD_TO_PIXEL;
  const cameraY = snapshot.player.y * WORLD_TO_PIXEL;
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
    Math.min(viewport.width, viewport.height) * 0.16,
    viewport.width / 2,
    viewport.height / 2,
    Math.max(viewport.width, viewport.height) * 0.7,
  );
  vignette.addColorStop(0, 'rgb(8 10 11 / 0%)');
  vignette.addColorStop(1, 'rgb(0 0 0 / 62%)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, viewport.width, viewport.height);
}

function drawPickups(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  const stride = snapshot.pickups.length > 700 ? 2 : 1;
  for (let index = 0; index < snapshot.pickups.length; index += stride) {
    const pickup = snapshot.pickups[index]!;
    const position = onScreen(pickup.x, pickup.y, snapshot, viewport);
    const size = pickup.kind === 'CHEST' ? 54 : 25;
    if (!visible(position.x, position.y, size, viewport)) continue;
    const pulse = 1 + Math.sin((snapshot.tick + pickup.id * 13) * 0.08) * 0.08;
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

function drawEnemy(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
  enemy: RuntimeSnapshot['enemies'][number],
) {
  const position = onScreen(enemy.x, enemy.y, snapshot, viewport);
  const worldSize = enemy.radius * 2 * WORLD_TO_PIXEL;
  const size = enemy.role === 'FINAL_BOSS'
    ? Math.max(260, worldSize * 1.45)
    : enemy.role === 'MID_BOSS'
      ? Math.max(160, worldSize * 1.35)
      : Math.max(110, worldSize * 1.5);
  if (!visible(position.x, position.y, size, viewport)) return;

  context.save();
  context.globalAlpha = 0.5;
  context.fillStyle = '#000';
  context.beginPath();
  context.ellipse(position.x, position.y + size * 0.28, size * 0.28, size * 0.11, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  if (enemy.role === 'FINAL_BOSS') {
    drawFullImage(
      context,
      images['final-boss'],
      position.x - size * 0.5,
      position.y - size * 0.62,
      size,
      size * 1.25,
    );
  } else {
    const definition = enemyCell(enemy.enemyId);
    if (definition) {
      const bob = Math.sin((snapshot.tick + enemy.id * 7) * 0.07) * 2;
      drawAtlasCell(
        context,
        images,
        definition,
        position.x - size / 2,
        position.y - size / 2 + bob,
        size,
        size,
      );
    } else {
      context.fillStyle = '#8b2e27';
      context.fillRect(position.x - size / 3, position.y - size / 3, size * 0.66, size * 0.66);
    }
  }

  if (enemy.role !== 'NORMAL') {
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    const barWidth = Math.min(150, size * 0.72);
    context.fillStyle = 'rgb(0 0 0 / 72%)';
    context.fillRect(position.x - barWidth / 2, position.y + size * 0.42, barWidth, 5);
    context.fillStyle = enemy.role === 'FINAL_BOSS' ? '#cf4633' : '#b48342';
    context.fillRect(position.x - barWidth / 2, position.y + size * 0.42, barWidth * ratio, 5);
  }
}

function drawEnemies(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  const normalEnemies = snapshot.enemies.filter((enemy) => enemy.role === 'NORMAL');
  const stride = normalEnemies.length > 900 ? Math.ceil(normalEnemies.length / 900) : 1;
  for (let index = 0; index < normalEnemies.length; index += stride) {
    drawEnemy(context, images, snapshot, viewport, normalEnemies[index]!);
  }
  for (const enemy of snapshot.enemies) {
    if (enemy.role !== 'NORMAL') drawEnemy(context, images, snapshot, viewport, enemy);
  }
}

function drawProjectiles(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  const stride = snapshot.projectiles.length > 1_100
    ? Math.ceil(snapshot.projectiles.length / 1_100)
    : 1;
  for (let index = 0; index < snapshot.projectiles.length; index += stride) {
    const projectile = snapshot.projectiles[index]!;
    const position = onScreen(projectile.x, projectile.y, snapshot, viewport);
    const size = Math.max(34, Math.min(150, projectile.radius * 2 * WORLD_TO_PIXEL * 2.2));
    if (!visible(position.x, position.y, size, viewport)) continue;
    const definition = vfxCell(projectile.weaponId);
    if (definition) {
      context.save();
      context.translate(position.x, position.y);
      context.rotate(projectile.rotation);
      drawAtlasCell(context, images, definition, -size / 2, -size / 2, size, size, 0.88);
      context.restore();
    } else {
      context.fillStyle = '#e9e0c9';
      context.fillRect(position.x - 3, position.y - 3, 6, 6);
    }
  }
}

function drawVfx(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
  settings: RenderSettings,
) {
  const limit = settings.reducedMotion ? 80 : 180;
  const vfx = snapshot.vfx.slice(-limit);
  for (const effect of vfx) {
    const position = onScreen(effect.x, effect.y, snapshot, viewport);
    const life = Math.min(1, effect.ttlTicks / 30);
    if (!visible(position.x, position.y, effect.radius, viewport)) continue;
    const definition = effect.weaponId ? vfxCell(effect.weaponId) : null;
    if (definition && effect.kind !== 'HIT') {
      const size = Math.max(48, effect.radius * 2 * WORLD_TO_PIXEL);
      drawAtlasCell(
        context,
        images,
        definition,
        position.x - size / 2,
        position.y - size / 2,
        size,
        size,
        Math.max(0.18, life * (settings.flashes ? 0.72 : 0.38)),
      );
      continue;
    }

    context.save();
    context.globalAlpha = Math.max(0.12, life * (settings.flashes ? 0.85 : 0.4));
    context.strokeStyle = settings.blood ? '#6e241f' : '#dcd2bd';
    context.lineWidth = 2;
    const radius = Math.max(4, effect.radius * WORLD_TO_PIXEL * (1.2 - life * 0.35));
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    if (settings.damageNumbers && effect.kind === 'HIT' && effect.id % 3 === 0) {
      context.save();
      context.fillStyle = '#f1e5cb';
      context.strokeStyle = '#050505';
      context.lineWidth = 3;
      context.font = '700 12px system-ui';
      const label = `${8 + (effect.id % 47)}`;
      context.strokeText(label, position.x + 4, position.y - 9 - (1 - life) * 9);
      context.fillText(label, position.x + 4, position.y - 9 - (1 - life) * 9);
      context.restore();
    }
  }
}

function drawPlayer(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
) {
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  const size = Math.min(
    170,
    Math.max(120, Math.min(viewport.width, viewport.height) * 0.18),
  );
  const pulse = snapshot.player.invulnerableTicks > 0 && snapshot.tick % 8 < 4 ? 0.45 : 1;

  context.save();
  context.globalAlpha = 0.55;
  context.fillStyle = '#000';
  context.beginPath();
  context.ellipse(x, y + size * 0.3, size * 0.23, size * 0.08, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  drawAtlasCell(
    context,
    images,
    playerCell(playerDirection(snapshot)),
    x - size / 2,
    y - size * 0.58,
    size,
    size,
    pulse,
  );

  context.save();
  context.strokeStyle = 'rgb(97 217 220 / 52%)';
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(x, y + size * 0.28, size * 0.3, size * 0.11, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

export function renderRuntimeFrame(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  snapshot: RuntimeSnapshot,
  viewport: Viewport,
  settings: RenderSettings,
) {
  const shakeAmount = settings.shake && !settings.reducedMotion && snapshot.vfx.some((vfx) => vfx.kind === 'BOSS_WARNING')
    ? 4
    : 0;
  const shakeX = shakeAmount ? Math.sin(snapshot.tick * 2.17) * shakeAmount : 0;
  const shakeY = shakeAmount ? Math.cos(snapshot.tick * 1.71) * shakeAmount : 0;

  context.save();
  context.translate(shakeX, shakeY);
  drawFloor(context, images, snapshot, viewport);
  drawPickups(context, images, snapshot, viewport);
  drawEnemies(context, images, snapshot, viewport);
  drawProjectiles(context, images, snapshot, viewport);
  drawVfx(context, images, snapshot, viewport, settings);
  drawPlayer(context, images, snapshot, viewport);
  context.restore();

  if (snapshot.mode === 'PAUSED' || snapshot.mode === 'LEVEL_UP' || snapshot.mode === 'CHEST') {
    context.fillStyle = 'rgb(1 2 3 / 26%)';
    context.fillRect(0, 0, viewport.width, viewport.height);
  }
}
