import Phaser from 'phaser';
import {
  EMPTY_HYOSAN_INPUT,
  HYOSAN_FIXED_TIMESTEP_MS,
  createHyosanSimulation,
  type HyosanSimulationEvent,
  type HyosanSimulationSnapshot,
} from '@/lib/games/hyosan-memories/simulation';
import type { HyosanMobileInputBridge } from './input-bridge';

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const DEFAULT_ZOMBIE_COUNT = 24;
const MAX_CATCH_UP_STEPS = 8;

export interface HyosanHudState {
  health: number;
  remaining: number;
  total: number;
  roomLocked: boolean;
  roomCleared: boolean;
  roomStarted: boolean;
  roomExited: boolean;
  defeated: boolean;
  fps: number;
  step: number;
  playerX: number;
  playerY: number;
}

export type HyosanRuntimeAction =
  | { code: 'attack'; label: `${1 | 2 | 3}타` }
  | { code: 'skill'; label: '감각 펄스' }
  | { code: 'dash'; label: '대시' }
  | { code: 'hit'; label: '피격' }
  | { code: 'room_unlocked'; label: '급식실 문 개방' }
  | { code: 'room_exited'; label: '급식실 탈출' };

export interface HyosanRuntimeOptions {
  parent: HTMLElement;
  mobileInput: HyosanMobileInputBridge;
  seed: string;
  reducedMotion: boolean;
  onReady(): void;
  onHud(state: HyosanHudState): void;
  onAction(action: HyosanRuntimeAction): void;
}

interface HyosanKeys {
  upW: Phaser.Input.Keyboard.Key;
  downS: Phaser.Input.Keyboard.Key;
  leftA: Phaser.Input.Keyboard.Key;
  rightD: Phaser.Input.Keyboard.Key;
  upArrow: Phaser.Input.Keyboard.Key;
  downArrow: Phaser.Input.Keyboard.Key;
  leftArrow: Phaser.Input.Keyboard.Key;
  rightArrow: Phaser.Input.Keyboard.Key;
  attack: Phaser.Input.Keyboard.Key;
  skill: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key;
}

interface KeyboardEdges {
  attack: boolean;
  skill: boolean;
  dash: boolean;
}

function drawCafeteriaGraybox(scene: Phaser.Scene) {
  const room = scene.add.graphics();
  room.fillStyle(0x11191b, 1);
  room.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  room.fillStyle(0x243033, 1);
  room.fillRect(72, 72, 1136, 576);
  room.fillRect(552, 0, 176, 72);

  room.lineStyle(1, 0x4c5c5e, 0.34);
  for (let x = 96; x < 1208; x += 64) {
    room.lineBetween(x, 72, x, 648);
  }
  for (let y = 96; y < 648; y += 64) {
    room.lineBetween(72, y, 1208, y);
  }

  room.fillStyle(0x0b1011, 1);
  room.fillRect(48, 48, 504, 24);
  room.fillRect(728, 48, 504, 24);
  room.fillRect(48, 648, 1184, 24);
  room.fillRect(48, 48, 24, 624);
  room.fillRect(1208, 48, 24, 624);

  room.fillStyle(0x5d6a65, 0.5);
  for (const y of [244, 388]) {
    for (const x of [310, 510, 770, 970]) {
      room.fillRoundedRect(x - 58, y - 20, 116, 40, 8);
    }
  }

  room.lineStyle(3, 0xaab8b2, 0.32);
  room.strokeRect(88, 88, 1104, 544);
}

function keyboardMovement(keys: HyosanKeys): { x: number; y: number } {
  return {
    x: Number(keys.rightD.isDown || keys.rightArrow.isDown)
      - Number(keys.leftA.isDown || keys.leftArrow.isDown),
    y: Number(keys.downS.isDown || keys.downArrow.isDown)
      - Number(keys.upW.isDown || keys.upArrow.isDown),
  };
}

export function mountHyosanPhaserGame(options: HyosanRuntimeOptions): Phaser.Game {
  class HyosanGrayboxScene extends Phaser.Scene {
    private readonly simulation = createHyosanSimulation({
      seed: options.seed,
      zombieCount: DEFAULT_ZOMBIE_COUNT,
    });

    private accumulator = 0;
    private keys: HyosanKeys | null = null;
    private pendingKeyboard: KeyboardEdges = { attack: false, skill: false, dash: false };
    private playerView: Phaser.GameObjects.Rectangle | null = null;
    private doorView: Phaser.GameObjects.Rectangle | null = null;
    private readonly zombieViews = new Map<string, Phaser.GameObjects.Rectangle>();
    private eventCursor = 0;
    private lastHudStep = -1;

    constructor() {
      super({ key: 'HyosanCafeteriaGraybox' });
    }

    create() {
      drawCafeteriaGraybox(this);
      this.doorView = this.add.rectangle(640, 72, 176, 26, 0xb53b36).setStrokeStyle(3, 0x24100f);

      const snapshot = this.simulation.getSnapshot();
      for (const zombie of snapshot.zombies) {
        const view = this.add
          .rectangle(zombie.x, zombie.y, 30, 42, 0xb44542)
          .setStrokeStyle(2, 0x3b1111);
        this.zombieViews.set(zombie.id, view);
      }

      this.playerView = this.add
        .rectangle(snapshot.player.x, snapshot.player.y, 32, 44, 0x6eb7b0)
        .setStrokeStyle(3, 0xd8f0e9);

      const keyboard = this.input.keyboard;
      if (keyboard) {
        this.keys = keyboard.addKeys({
          upW: Phaser.Input.Keyboard.KeyCodes.W,
          downS: Phaser.Input.Keyboard.KeyCodes.S,
          leftA: Phaser.Input.Keyboard.KeyCodes.A,
          rightD: Phaser.Input.Keyboard.KeyCodes.D,
          upArrow: Phaser.Input.Keyboard.KeyCodes.UP,
          downArrow: Phaser.Input.Keyboard.KeyCodes.DOWN,
          leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
          rightArrow: Phaser.Input.Keyboard.KeyCodes.RIGHT,
          attack: Phaser.Input.Keyboard.KeyCodes.J,
          skill: Phaser.Input.Keyboard.KeyCodes.K,
          dash: Phaser.Input.Keyboard.KeyCodes.L,
        }, true, false) as HyosanKeys;
        this.keys.attack.on('down', () => { this.pendingKeyboard.attack = true; });
        this.keys.skill.on('down', () => { this.pendingKeyboard.skill = true; });
        this.keys.dash.on('down', () => { this.pendingKeyboard.dash = true; });
      }

      this.eventCursor = this.simulation.getEventLog().length;
      this.renderSnapshot(snapshot);
      this.publishHud(snapshot);
      this.game.canvas.dataset.testid = 'hyosan-canvas';
      this.game.canvas.dataset.reducedMotion = options.reducedMotion ? 'true' : 'false';
      this.game.canvas.setAttribute('aria-label', '효산고 급식실 그레이박스 플레이필드');
      options.onReady();
    }

    update(_time: number, delta: number) {
      if (!this.playerView) return;
      this.accumulator = Math.min(
        this.accumulator + delta,
        HYOSAN_FIXED_TIMESTEP_MS * MAX_CATCH_UP_STEPS,
      );

      while (this.accumulator >= HYOSAN_FIXED_TIMESTEP_MS) {
        const keyboardMove = this.keys ? keyboardMovement(this.keys) : { x: 0, y: 0 };
        const mobileMove = options.mobileInput.getMovement();
        const mobilePresses = options.mobileInput.consumePresses();
        const input = {
          ...EMPTY_HYOSAN_INPUT,
          moveX: keyboardMove.x + mobileMove.x,
          moveY: keyboardMove.y + mobileMove.y,
          attackPressed: this.pendingKeyboard.attack || mobilePresses.attackPressed,
          skillPressed: this.pendingKeyboard.skill || mobilePresses.skillPressed,
          dashPressed: this.pendingKeyboard.dash || mobilePresses.dashPressed,
        };
        this.pendingKeyboard = { attack: false, skill: false, dash: false };
        this.simulation.step(input);
        this.accumulator -= HYOSAN_FIXED_TIMESTEP_MS;
      }

      const snapshot = this.simulation.getSnapshot();
      const ended = snapshot.player.defeated || snapshot.room.exited;
      this.renderSnapshot(snapshot);
      this.renderNewEvents(snapshot);
      if (ended || snapshot.step - this.lastHudStep >= 6) this.publishHud(snapshot);
      if (ended) this.game.loop.sleep();
    }

    private renderSnapshot(snapshot: HyosanSimulationSnapshot) {
      const player = snapshot.player;
      this.playerView
        ?.setPosition(player.x, player.y)
        .setRotation(Math.atan2(player.facingY, player.facingX) + Math.PI / 2)
        .setFillStyle(player.invulnerable ? 0xf1d77b : player.defeated ? 0x536063 : 0x6eb7b0)
        .setAlpha(player.dashing ? 0.62 : 1);

      for (const zombie of snapshot.zombies) {
        this.zombieViews.get(zombie.id)
          ?.setPosition(zombie.x, zombie.y)
          .setVisible(!zombie.defeated);
      }

      this.doorView?.setVisible(snapshot.room.locked);
    }

    private renderNewEvents(snapshot: HyosanSimulationSnapshot) {
      const events = this.simulation.getEventsSince(this.eventCursor);
      for (const event of events) {
        this.renderEvent(event, snapshot);
      }
      this.eventCursor += events.length;
    }

    private renderEvent(event: HyosanSimulationEvent, snapshot: HyosanSimulationSnapshot) {
      if (event.type === 'player_attack') {
        options.onAction({ code: 'attack', label: `${event.combo}타` });
        const slash = this.add.graphics();
        slash.lineStyle(9, event.combo === 3 ? 0xf1d77b : 0xd8f0e9, 0.86);
        slash.lineBetween(
          snapshot.player.x,
          snapshot.player.y,
          snapshot.player.x + event.directionX * 82,
          snapshot.player.y + event.directionY * 82,
        );
        this.time.delayedCall(90, () => slash.destroy());
        return;
      }

      if (event.type === 'zombie_hit') {
        const view = this.zombieViews.get(event.zombieId);
        if (view) {
          view.setFillStyle(0xf0d1b2);
          if (options.reducedMotion) {
            this.time.delayedCall(90, () => view.setFillStyle(0xb44542));
          } else {
            view.setScale(1.18);
            this.tweens.add({
              targets: view,
              scaleX: 1,
              scaleY: 1,
              duration: 90,
              onComplete: () => view.setFillStyle(0xb44542),
            });
          }
        }
        return;
      }

      if (event.type === 'player_dashed') {
        options.onAction({ code: 'dash', label: '대시' });
        return;
      }

      if (event.type === 'skill_used') {
        options.onAction({ code: 'skill', label: '감각 펄스' });
        const pulse = this.add.circle(
          snapshot.player.x,
          snapshot.player.y,
          options.reducedMotion ? 64 : 28,
          0x7dd8d0,
          0,
        )
          .setStrokeStyle(5, 0x7dd8d0, 0.9);
        if (options.reducedMotion) {
          this.time.delayedCall(120, () => pulse.destroy());
        } else {
          this.tweens.add({
            targets: pulse,
            scaleX: 5,
            scaleY: 5,
            alpha: 0,
            duration: 420,
            onComplete: () => pulse.destroy(),
          });
        }
        return;
      }

      if (event.type === 'player_hit') {
        options.onAction({ code: 'hit', label: '피격' });
        if (!options.reducedMotion) this.cameras.main.shake(90, 0.004);
        return;
      }

      if (event.type === 'room_unlocked') {
        options.onAction({ code: 'room_unlocked', label: '급식실 문 개방' });
        if (!options.reducedMotion) this.cameras.main.flash(220, 101, 184, 144);
        return;
      }

      if (event.type === 'room_exited') {
        options.onAction({ code: 'room_exited', label: '급식실 탈출' });
        if (!options.reducedMotion) this.cameras.main.flash(260, 216, 240, 233);
      }
    }

    private publishHud(snapshot: HyosanSimulationSnapshot) {
      this.lastHudStep = snapshot.step;
      options.onHud({
        health: snapshot.player.health,
        remaining: snapshot.zombies.filter((zombie) => !zombie.defeated).length,
        total: snapshot.zombies.length,
        roomLocked: snapshot.room.locked,
        roomCleared: snapshot.room.cleared,
        roomStarted: snapshot.room.started,
        roomExited: snapshot.room.exited,
        defeated: snapshot.player.defeated,
        fps: Math.round(Number.isFinite(this.game.loop.actualFps) ? this.game.loop.actualFps : 0),
        step: snapshot.step,
        playerX: Math.round(snapshot.player.x),
        playerY: Math.round(snapshot.player.y),
      });
    }
  }

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: '#0b1011',
    scene: HyosanGrayboxScene,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    },
    input: { keyboard: true, mouse: true, touch: true },
    render: { antialias: true, roundPixels: true },
    banner: false,
  });
}
