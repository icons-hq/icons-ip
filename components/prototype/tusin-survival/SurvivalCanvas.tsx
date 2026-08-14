'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  appendLeaderboardRecord,
  parseLeaderboardRecords,
  rankScoreRecords,
  rankSpeedrunRecords,
  type LeaderboardRecord,
} from '@/lib/prototypes/tusin-survival/leaderboard';
import {
  runRecordedCommands,
  type ReplayOutcome,
  type RunResult,
} from '@/lib/prototypes/tusin-survival/engine';
import { tusinSurvivalPack } from '@/lib/prototypes/tusin-survival/packs/tusin';
import { evaluateMockRewards } from '@/lib/prototypes/tusin-survival/rewards';
import { tusinSurvivalAssetUrl } from '@/lib/prototypes/tusin-survival/assets';
import { GameAudio } from './audio';
import { renderRuntimeFrame, type RenderSettings } from './render';
import {
  createRuntime,
  type BuildItemSnapshot,
  type InteractiveRuntime,
  type MoveIntent,
  type RuntimeMode,
  type RuntimeSnapshot,
} from './runtime';
import {
  abilityIconCell,
  pickupCell,
  type AtlasCell,
  type SpriteImages,
  loadSpriteImages,
} from './sprites';
import styles from './tusin-survival.module.css';

const STORAGE_KEY = 'icons:tusin-survival:local-leaderboard:v1';
const FIXED_STEP_MS = 1_000 / 60;
const STAGE_TICKS = 360 * 60;

interface AccessibilitySettings extends RenderSettings {
  music: number;
  sfx: number;
}

interface TouchStickState {
  pointerId: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
}

interface ReplayVerification {
  status: 'idle' | 'pending' | 'verified' | 'failed' | 'debug';
  outcome: ReplayOutcome | null;
}

const DEFAULT_SETTINGS: AccessibilitySettings = {
  music: 0.28,
  sfx: 0.52,
  flashes: true,
  shake: true,
  damageNumbers: true,
  blood: false,
  reducedMotion: false,
};

const BOSS_NAMES: Record<string, string> = {
  'abyss-armored-captain': '심연의 철갑대장',
  'black-dragon-siege-mage': '흑룡 공성마도사',
  'demon-army-vanguard': '마신군 선봉장',
};

const EVOLUTION_BASE_ICONS: Record<string, string> = Object.fromEntries(
  tusinSurvivalPack.evolutions.map((evolution) => [evolution.id, evolution.recipe.activeId]),
);

const EVOLUTION_NAMES: Record<string, string> = Object.fromEntries(
  tusinSurvivalPack.evolutions.map((evolution) => [evolution.id, evolution.name.text]),
);

function createSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `zephyr-${values[0]!.toString(36)}-${values[1]!.toString(36)}`;
}

function createInitialRun() {
  const seed = createSeed();
  const runtime = createRuntime(seed);
  return { seed, runtime, snapshot: runtime.getSnapshot() };
}

function readLocalLeaderboard() {
  try {
    return parseLeaderboardRecords(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function formatTicks(ticks: number | null) {
  if (ticks === null || !Number.isFinite(ticks)) return '—';
  const totalSeconds = Math.max(0, Math.floor(ticks / 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor(((ticks % 60) / 60) * 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

function formatStageTime(snapshot: RuntimeSnapshot) {
  if (
    snapshot.mode === 'FINAL_BOSS'
    || snapshot.mode === 'FINAL_TRANSITION'
    || snapshot.mode === 'RESULT_CLEAR'
  ) {
    return `6:00 + ${formatTicks(snapshot.bossFightTicks)}`;
  }
  return formatTicks(snapshot.stageTick).slice(0, 4);
}

function displayIconId(id: string) {
  return EVOLUTION_BASE_ICONS[id] ?? id;
}

function bossMilestoneName(bossId: string) {
  const definition = [
    ...tusinSurvivalPack.midbosses,
    ...(tusinSurvivalPack.finalBoss ? [tusinSurvivalPack.finalBoss] : []),
  ].find((boss) => boss.id === bossId);
  return definition ? BOSS_NAMES[definition.enemyId] ?? definition.enemyId : bossId;
}

function AtlasVisual({
  cell,
  className,
  label,
}: {
  cell: AtlasCell | null;
  className?: string;
  label?: string;
}) {
  if (!cell) return <span className={className} aria-label={label} />;
  const horizontal = cell.columns === 1 ? 50 : (cell.column / (cell.columns - 1)) * 100;
  const vertical = cell.rows === 1 ? 50 : (cell.row / (cell.rows - 1)) * 100;
  const style = {
    backgroundImage: `url(${tusinSurvivalAssetUrl(cell.assetId)})`,
    backgroundSize: `${cell.columns * 100}% ${cell.rows * 100}%`,
    backgroundPosition: `${horizontal}% ${vertical}%`,
  } satisfies CSSProperties;
  return <span className={`${styles.atlasIcon} ${className ?? ''}`} style={style} aria-label={label} />;
}

function BuildSlots({
  items,
  limit = 6,
}: {
  items: readonly BuildItemSnapshot[];
  limit?: number;
}) {
  const slots = Array.from({ length: limit }, (_, index) => items[index] ?? null);
  return (
    <div className={styles.slotRow}>
      {slots.map((item, index) => {
        const iconId = item ? displayIconId(item.evolvedInto ?? item.id) : null;
        return (
          <span
            className={`${styles.slot} ${item?.evolvedInto ? styles.slotEvolved : ''}`}
            key={item?.id ?? `empty-${index}`}
            title={item ? `${item.name} · Lv.${item.level}` : '빈 슬롯'}
          >
            {iconId ? <AtlasVisual cell={abilityIconCell(iconId)} label={item?.name} /> : null}
            {item ? <span className={styles.slotLevel}>{item.evolvedInto ? 'E' : item.level}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function SettingsControls({
  settings,
  onChange,
}: {
  settings: AccessibilitySettings;
  onChange: (settings: AccessibilitySettings) => void;
}) {
  const toggles: Array<[keyof Pick<AccessibilitySettings, 'flashes' | 'shake' | 'damageNumbers' | 'blood' | 'reducedMotion'>, string]> = [
    ['flashes', '피격 플래시'],
    ['shake', '화면 흔들림'],
    ['damageNumbers', '피해 숫자'],
    ['blood', '붉은 파편'],
    ['reducedMotion', '움직임 줄이기'],
  ];
  return (
    <>
      <div className={styles.rangeList}>
        <label className={styles.rangeRow}>
          <span>음악</span>
          <input
            aria-label="음악 음량"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.music}
            onChange={(event) => onChange({ ...settings, music: Number(event.target.value) })}
          />
          <span>{Math.round(settings.music * 100)}%</span>
        </label>
        <label className={styles.rangeRow}>
          <span>효과음</span>
          <input
            aria-label="효과음 음량"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.sfx}
            onChange={(event) => onChange({ ...settings, sfx: Number(event.target.value) })}
          />
          <span>{Math.round(settings.sfx * 100)}%</span>
        </label>
      </div>
      <div className={styles.toggleGrid}>
        {toggles.map(([key, label]) => (
          <button
            className={`${styles.toggleButton} ${settings[key] ? styles.toggleOn : ''}`}
            type="button"
            key={key}
            aria-pressed={settings[key]}
            onClick={() => onChange({ ...settings, [key]: !settings[key] })}
          >
            <span>{label}</span>
            <span>{settings[key] ? 'ON' : 'OFF'}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function currentIntent(keys: ReadonlySet<string>, touch: TouchStickState | null): MoveIntent {
  let x = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  let y = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
  if (touch) {
    const deltaX = touch.currentX - touch.originX;
    const deltaY = touch.currentY - touch.originY;
    const length = Math.hypot(deltaX, deltaY);
    if (length > 5) {
      x += deltaX / Math.max(48, length);
      y += deltaY / Math.max(48, length);
    }
  }
  return { x, y };
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden'));
}

export default function SurvivalCanvas() {
  const [initialRun] = useState(createInitialRun);
  const runtimeRef = useRef<InteractiveRuntime>(initialRun.runtime);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pauseDialogRef = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef<SpriteImages | null>(null);
  const latestSnapshotRef = useRef(initialRun.snapshot);
  const keysRef = useRef(new Set<string>());
  const touchRef = useRef<TouchStickState | null>(null);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const audioRef = useRef<GameAudio | null>(null);
  const resultSavedRef = useRef<string | null>(null);
  const previousModeRef = useRef<RuntimeMode>(initialRun.snapshot.mode);

  const [snapshot, setSnapshot] = useState(initialRun.snapshot);
  const [seedInput, setSeedInput] = useState(initialRun.seed);
  const [assetsReady, setAssetsReady] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AccessibilitySettings>(() => ({
    ...DEFAULT_SETTINGS,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  const [touchStick, setTouchStick] = useState<TouchStickState | null>(null);
  const [leaderboardRecords, setLeaderboardRecords] = useState<LeaderboardRecord[]>(readLocalLeaderboard);
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const [leaderboardView, setLeaderboardView] = useState<'score' | 'speedrun'>('score');
  const [replayVerification, setReplayVerification] = useState<ReplayVerification>({
    status: 'idle',
    outcome: null,
  });
  const [resultSnapshot, setResultSnapshot] = useState<RunResult | null>(null);
  const [fps, setFps] = useState(0);
  const [telemetry, setTelemetry] = useState({ frameMs: 0, simulationMs: 0, renderMs: 0 });
  const [toast, setToast] = useState<string | null>(null);

  const commit = useCallback((next: RuntimeSnapshot) => {
    latestSnapshotRef.current = next;
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    audioRef.current?.setSettings({ music: settings.music, sfx: settings.sfx });
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    loadSpriteImages()
      .then((images) => {
        if (cancelled) return;
        imagesRef.current = images;
        setAssetsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAssetError('도트 에셋을 불러오지 못했습니다. 프로토타입 플래그와 asset route를 확인해 주세요.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(bounds.width * dpr));
      canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const audio = new GameAudio();
    audioRef.current = audio;
    audio.setSettings({ music: settingsRef.current.music, sfx: settingsRef.current.sfx });
    return () => {
      audio.close();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let accumulator = 0;
    let lastUiAt = 0;
    let fpsStartedAt = lastFrameAt;
    let frameCount = 0;
    let sampledSimulationMs = 0;
    let sampledRenderMs = 0;

    const frame = (now: number) => {
      const elapsed = Math.min(100, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      accumulator += elapsed;
      let latest = latestSnapshotRef.current;
      let simulated = false;
      const simulationStartedAt = performance.now();

      while (accumulator >= FIXED_STEP_MS) {
        if (latest.mode === 'RUNNING' || latest.mode === 'FINAL_BOSS') {
          latest = runtimeRef.current!.step(currentIntent(keysRef.current, touchRef.current));
          latestSnapshotRef.current = latest;
          simulated = true;
        }
        accumulator -= FIXED_STEP_MS;
        if (latest.mode !== 'RUNNING' && latest.mode !== 'FINAL_BOSS') break;
      }
      sampledSimulationMs += performance.now() - simulationStartedAt;

      if (simulated && (now - lastUiAt > 90 || latest.mode !== snapshot.mode)) {
        setSnapshot(latest);
        lastUiAt = now;
      }

      const images = imagesRef.current;
      const renderStartedAt = performance.now();
      if (images) {
        const bounds = canvas.getBoundingClientRect();
        const dpr = canvas.width / Math.max(1, bounds.width);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, bounds.width, bounds.height);
        renderRuntimeFrame(
          context,
          images,
          latest,
          { width: bounds.width, height: bounds.height },
          settingsRef.current,
        );
      }
      sampledRenderMs += performance.now() - renderStartedAt;

      if (latest.mode === 'RUNNING' || latest.mode === 'FINAL_BOSS') {
        audioRef.current?.updateMusic(
          Math.min(1, latest.stageTick / STAGE_TICKS + latest.enemies.length / 500),
          latest.mode === 'FINAL_BOSS',
        );
      }

      frameCount += 1;
      if (now - fpsStartedAt >= 1_000) {
        const sampleWindowMs = now - fpsStartedAt;
        const sampledFrames = Math.max(1, frameCount);
        setFps(Math.round((sampledFrames * 1_000) / sampleWindowMs));
        setTelemetry({
          frameMs: sampleWindowMs / sampledFrames,
          simulationMs: sampledSimulationMs / sampledFrames,
          renderMs: sampledRenderMs / sampledFrames,
        });
        frameCount = 0;
        fpsStartedAt = now;
        sampledSimulationMs = 0;
        sampledRenderMs = 0;
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [assetsReady, snapshot.mode]);

  useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = snapshot.mode;
    if (!previous || previous === snapshot.mode) return;
    if (snapshot.mode === 'LEVEL_UP') audioRef.current?.play('level');
    if (snapshot.mode === 'CHEST') audioRef.current?.play('chest');
    if (snapshot.mode === 'FINAL_TRANSITION') audioRef.current?.play('boss');
    if (snapshot.mode === 'RESULT_CLEAR') audioRef.current?.play('clear');
    if (snapshot.mode === 'RESULT_LOSS') audioRef.current?.play('loss');
  }, [snapshot.mode]);

  useEffect(() => {
    if (snapshot.mode !== 'RESULT_CLEAR' && snapshot.mode !== 'RESULT_LOSS') return;
    let cancelled = false;
    const runtime = runtimeRef.current;
    const liveResult = runtime.getRunResult();

    if (snapshot.debug.active) {
      queueMicrotask(() => {
        if (!cancelled) {
          setResultSnapshot(liveResult);
          setReplayVerification({ status: 'debug', outcome: null });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setReplayVerification({ status: 'pending', outcome: null });
      setResultSnapshot(liveResult);
      try {
        const outcome = runRecordedCommands(
          tusinSurvivalPack,
          snapshot.seed,
          runtime.getRecordedRun(),
        );
        const verified = outcome.status === 'TERMINAL'
          && JSON.stringify(outcome.result) === JSON.stringify(liveResult);
        if (!cancelled) {
          setReplayVerification({
            status: verified ? 'verified' : 'failed',
            outcome,
          });
        }
      } catch {
        if (!cancelled) setReplayVerification({ status: 'failed', outcome: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [snapshot.debug.active, snapshot.mode, snapshot.seed]);

  useEffect(() => {
    if (snapshot.mode !== 'RESULT_CLEAR' && snapshot.mode !== 'RESULT_LOSS') return;
    if (snapshot.debug.active) {
      queueMicrotask(() => setCurrentRecordId(null));
      return;
    }
    if (replayVerification.status !== 'verified' || !replayVerification.outcome) return;

    const result = replayVerification.outcome.result;
    const runKey = `${snapshot.seed}:${result.completionTicks}:${result.state}`;
    if (resultSavedRef.current === runKey) return;
    resultSavedRef.current = runKey;

    const record: LeaderboardRecord = {
      id: crypto.randomUUID(),
      seed: snapshot.seed,
      rawScore: result.rawScore,
      clear: result.state === 'RESULTS_CLEAR',
      bossSplitTicks: result.state === 'RESULTS_CLEAR' ? result.bossSplitTicks : null,
      completionTicks: result.completionTicks,
      recordedAt: Date.now(),
      debug: false,
    };
    queueMicrotask(() => {
      setLeaderboardRecords((current) => {
        const next = appendLeaderboardRecord(current, record);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // 로컬 기록 저장 실패는 게임 결과나 mock 보상을 바꾸지 않는다.
        }
        return next;
      });
      setCurrentRecordId(record.id);
    });
  }, [replayVerification, snapshot.debug.active, snapshot.mode, snapshot.seed]);

  const onChooseOffer = useCallback((index: number) => {
    commit(runtimeRef.current!.chooseOffer(index));
    audioRef.current?.play('start');
  }, [commit]);

  const onResolveChest = useCallback(() => {
    const chest = latestSnapshotRef.current.chest;
    const evolutionId = chest?.eligibleEvolutionIds[0];
    commit(runtimeRef.current!.resolveChest());
    setToast(evolutionId ? `${EVOLUTION_NAMES[evolutionId] ?? evolutionId} 진화 완료` : '보유 장비가 강화되었습니다.');
    window.setTimeout(() => setToast(null), 2_000);
  }, [commit]);

  const onTogglePause = useCallback(() => {
    commit(runtimeRef.current!.togglePause());
  }, [commit]);

  const onContinueBoss = useCallback(() => {
    commit(runtimeRef.current!.continueFinalTransition());
    audioRef.current?.play('boss');
  }, [commit]);

  const onStart = useCallback(async () => {
    if (!assetsReady) return;
    await audioRef.current?.resume();
    audioRef.current?.play('start');
    commit(runtimeRef.current!.start());
  }, [assetsReady, commit]);

  const resetRuntime = useCallback((requestedSeed?: string, debug = false) => {
    const nextSeed = requestedSeed?.trim() || createSeed();
    const runtime = createRuntime(nextSeed);
    if (debug) runtime.setDebug({});
    runtimeRef.current = runtime;
    const next = runtime.getSnapshot();
    resultSavedRef.current = null;
    setReplayVerification({ status: 'idle', outcome: null });
    setResultSnapshot(null);
    setCurrentRecordId(null);
    setSeedInput(nextSeed);
    keysRef.current.clear();
    touchRef.current = null;
    setTouchStick(null);
    commit(next);
  }, [commit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
      keysRef.current.add(event.code);
      const current = latestSnapshotRef.current;
      if (current.mode === 'LEVEL_UP' && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
        onChooseOffer(Number(event.code.at(-1)) - 1);
      } else if (event.code === 'Escape' && ['RUNNING', 'FINAL_BOSS', 'PAUSED'].includes(current.mode)) {
        onTogglePause();
      } else if (event.code === 'Enter') {
        if (current.mode === 'READY') void onStart();
        else if (current.mode === 'CHEST') onResolveChest();
        else if (current.mode === 'FINAL_TRANSITION') onContinueBoss();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    const onBlur = () => keysRef.current.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onChooseOffer, onContinueBoss, onResolveChest, onStart, onTogglePause]);

  useEffect(() => {
    const stateScreens = new Set<RuntimeMode>([
      'READY',
      'LEVEL_UP',
      'CHEST',
      'FINAL_TRANSITION',
      'RESULT_CLEAR',
      'RESULT_LOSS',
    ]);
    if (!stateScreens.has(snapshot.mode)) return;

    const screen = document.querySelector<HTMLElement>(`[data-game-state="${snapshot.mode}"]`);
    const target = screen?.querySelector<HTMLElement>('[data-state-primary]:not(:disabled)')
      ?? (screen ? focusableElements(screen)[0] : null)
      ?? screen;
    target?.focus();
  }, [assetError, assetsReady, snapshot.mode]);

  useEffect(() => {
    if (snapshot.mode !== 'PAUSED') return;
    const dialog = pauseDialogRef.current;
    if (!dialog) return;

    const returnTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const initialTarget = dialog.querySelector<HTMLElement>('[data-state-primary]')
      ?? focusableElements(dialog)[0]
      ?? dialog;
    initialTarget.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus, true);
    return () => {
      document.removeEventListener('keydown', trapFocus, true);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [snapshot.mode]);

  const beginTouch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = latestSnapshotRef.current;
    if (current.mode !== 'RUNNING' && current.mode !== 'FINAL_BOSS') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const state = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    };
    touchRef.current = state;
    setTouchStick(state);
  };

  const moveTouch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (touchRef.current?.pointerId !== event.pointerId) return;
    const state = { ...touchRef.current, currentX: event.clientX, currentY: event.clientY };
    touchRef.current = state;
    setTouchStick(state);
  };

  const endTouch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (touchRef.current?.pointerId !== event.pointerId) return;
    touchRef.current = null;
    setTouchStick(null);
  };

  const scoreRecords = useMemo(() => rankScoreRecords(leaderboardRecords), [leaderboardRecords]);
  const speedrunRecords = useMemo(() => rankSpeedrunRecords(leaderboardRecords), [leaderboardRecords]);
  const currentScoreRank = currentRecordId
    ? scoreRecords.findIndex((record) => record.id === currentRecordId) + 1
    : 0;
  const currentSpeedRank = currentRecordId
    ? speedrunRecords.findIndex((record) => record.id === currentRecordId) + 1
    : 0;
  const resultMode = snapshot.mode === 'RESULT_CLEAR' || snapshot.mode === 'RESULT_LOSS';
  const canonicalResult = resultMode
    ? replayVerification.outcome?.result ?? resultSnapshot
    : null;
  const defeatedBossIds = canonicalResult
    ? canonicalResult.bosses.filter((boss) => boss.killTick !== null).map((boss) => boss.id)
    : snapshot.score.bosses.filter((boss) => boss.killTick !== null).map((boss) => boss.id);
  const midbossKills = canonicalResult
    ? canonicalResult.bosses.filter(
        (boss) => boss.kind === 'MID_BOSS' && boss.killTick !== null,
      ).length
    : snapshot.score.bosses.filter(
        (boss) => boss.role === 'MID_BOSS' && boss.killTick !== null,
      ).length;
  const mockRewards = evaluateMockRewards(
    tusinSurvivalPack.mockRewards,
    {
      verified: replayVerification.status === 'verified',
      rawScore: canonicalResult?.rawScore ?? snapshot.score.rawScore,
      defeatedBossIds,
      finalBossCleared: canonicalResult?.state === 'RESULTS_CLEAR',
      clearTick: canonicalResult?.state === 'RESULTS_CLEAR'
        ? canonicalResult.completionTicks
        : null,
      bossSplitTicks: canonicalResult?.bossSplitTicks ?? snapshot.score.bossSplitTicks,
      leaderboardRank: currentSpeedRank > 0 ? currentSpeedRank : null,
      debug: snapshot.debug.active,
    },
  );

  const activeBoss = snapshot.enemies.find((enemy) => enemy.role === 'FINAL_BOSS')
    ?? snapshot.enemies.find((enemy) => enemy.role === 'MID_BOSS');
  const xpProgress = snapshot.player.xpToNext
    ? Math.min(100, (snapshot.player.xp / snapshot.player.xpToNext) * 100)
    : 100;
  const visibleLeaderboard = leaderboardView === 'score' ? scoreRecords : speedrunRecords;
  const touchDelta = touchStick
    ? {
        x: Math.max(-42, Math.min(42, touchStick.currentX - touchStick.originX)),
        y: Math.max(-42, Math.min(42, touchStick.currentY - touchStick.originY)),
      }
    : null;
  const verificationLabel = replayVerification.status === 'verified'
    ? `RUN VERIFIED LOCALLY · ${canonicalResult?.state === 'RESULTS_CLEAR' ? 'CLEAR' : 'LOSS'}`
    : replayVerification.status === 'failed'
      ? 'REPLAY VERIFICATION FAILED · EXCLUDED'
      : replayVerification.status === 'debug'
        ? 'DEBUG RUN · REWARD EXCLUDED'
        : 'VERIFYING DETERMINISTIC REPLAY…';

  return (
    <section className={styles.gameStage} aria-label="투신전생기 서바이벌 게임">
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={1280}
        height={720}
        onPointerDown={beginTouch}
        onPointerMove={moveTouch}
        onPointerUp={endTouch}
        onPointerCancel={endTouch}
      />

      {snapshot.mode !== 'READY' && !resultMode ? (
        <div
          className={styles.hud}
          aria-hidden={['PAUSED', 'LEVEL_UP', 'CHEST', 'FINAL_TRANSITION'].includes(snapshot.mode)}
          inert={['PAUSED', 'LEVEL_UP', 'CHEST', 'FINAL_TRANSITION'].includes(snapshot.mode)}
        >
          <div className={styles.topBar}>
            <div className={styles.levelPlate}>
              <span>level</span>
              <strong>LV {snapshot.player.level}</strong>
            </div>
            <div className={styles.experienceWrap}>
              <div className={styles.experienceBar}>
                <div className={styles.experienceFill} style={{ width: `${xpProgress}%` }} />
              </div>
              <div className={styles.experienceMeta}>
                <span>전투 기억</span>
                <span>{snapshot.player.xp} / {snapshot.player.xpToNext ?? 'MAX'}</span>
              </div>
              <div className={styles.timerPlate}>
                <strong>{formatStageTime(snapshot)}</strong>
                <span>
                  {snapshot.mode === 'FINAL_BOSS' || snapshot.mode === 'FINAL_TRANSITION'
                    ? 'FINAL BATTLE'
                    : 'LAST FRONT'}
                </span>
              </div>
            </div>
            <div className={styles.scorePlate}>
              <div>
                <span>raw score</span>
                <strong>{snapshot.score.rawScore.toLocaleString('ko-KR')}</strong>
              </div>
              <strong className={styles.killCount}>× {snapshot.score.kills}</strong>
            </div>
          </div>

          <aside className={styles.buildRail} aria-label="현재 빌드">
            <div className={styles.buildHeading}><span>ACTIVE</span><span>{snapshot.build.actives.length}/6</span></div>
            <BuildSlots items={snapshot.build.actives} />
            <div className={styles.buildHeading}><span>PASSIVE</span><span>{snapshot.build.passives.length}/6</span></div>
            <BuildSlots items={snapshot.build.passives} />
          </aside>

          <div className={styles.controlRail}>
            <button className={styles.controlButton} type="button" onClick={onTogglePause} aria-label="일시정지">
              Ⅱ
            </button>
          </div>

          <div className={styles.playerHealth} aria-label={`생명력 ${snapshot.player.hp} / ${snapshot.player.maxHp}`}>
            <div
              className={styles.playerHealthFill}
              style={{ width: `${Math.max(0, (snapshot.player.hp / snapshot.player.maxHp) * 100)}%` }}
            />
          </div>

          {activeBoss ? (
            <div className={styles.bossRail}>
              <div className={styles.bossCard}>
                <div className={styles.bossMeta}>
                  <strong>{BOSS_NAMES[activeBoss.enemyId] ?? activeBoss.enemyId}</strong>
                  <span>{activeBoss.role === 'FINAL_BOSS' ? '최종보스' : '중간보스'}</span>
                </div>
                <div className={styles.healthBar}>
                  <div className={styles.healthFill} style={{ width: `${Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100)}%` }} />
                </div>
              </div>
            </div>
          ) : null}

          <details className={styles.debugPanel}>
            <summary>INTERNAL DEBUG · seed {snapshot.seed}</summary>
            <div className={styles.debugStats}>
              <span>{fps} FPS</span>
              <span>{telemetry.frameMs.toFixed(1)}ms FRAME</span>
              <span>{telemetry.simulationMs.toFixed(2)}ms SIM</span>
              <span>{telemetry.renderMs.toFixed(2)}ms RENDER</span>
              <span>{snapshot.metrics.enemyCount} ENEMY</span>
              <span>{snapshot.metrics.projectileCount} PROJECTILE</span>
              <span>{snapshot.metrics.pickupCount} PICKUP</span>
            </div>
            <div className={styles.debugActions}>
              <button
                className={styles.debugButton}
                type="button"
                onClick={() => commit(runtimeRef.current!.setDebug({ invincible: !snapshot.debug.invincible }))}
              >
                무적 {snapshot.debug.invincible ? 'ON' : 'OFF'}
              </button>
              <button
                className={styles.debugButton}
                type="button"
                onClick={() => commit(runtimeRef.current!.setDebug({ timeScale: snapshot.debug.timeScale === 1 ? 4 : 1 }))}
              >
                ×{snapshot.debug.timeScale}
              </button>
              <button className={styles.debugButton} type="button" onClick={() => commit(runtimeRef.current!.debugGrantXp(999))}>+XP</button>
              <button className={styles.debugButton} type="button" onClick={() => commit(runtimeRef.current!.debugSpawnChest())}>상자</button>
              <button
                className={styles.debugButton}
                type="button"
                onClick={() => commit(runtimeRef.current!.debugPopulateStress(
                  window.innerWidth <= 800 ? 500 : 1_000,
                  window.innerWidth <= 800 ? 800 : 1_500,
                ))}
              >
                STRESS
              </button>
              <button
                className={styles.debugButton}
                type="button"
                onClick={() => {
                  runtimeRef.current!.debugJumpToStageTick(STAGE_TICKS - 1);
                  commit(runtimeRef.current!.step());
                }}
              >
                최종보스 직행
              </button>
              {activeBoss ? (
                <button
                  className={styles.debugButton}
                  type="button"
                  onClick={() => commit(runtimeRef.current!.debugDamageEnemy(activeBoss.id, activeBoss.maxHp))}
                >
                  보스 테스트 처치
                </button>
              ) : null}
            </div>
          </details>
        </div>
      ) : null}

      {touchStick && touchDelta ? (
        <div
          className={styles.touchStick}
          style={{ left: touchStick.originX, top: touchStick.originY }}
          aria-hidden="true"
        >
          <span
            className={styles.touchKnob}
            style={{ '--stick-x': `${touchDelta.x}px`, '--stick-y': `${touchDelta.y}px` } as CSSProperties}
          />
        </div>
      ) : null}

      {toast ? <div className={styles.toastStack}><div className={styles.toast}>{toast}</div></div> : null}

      {snapshot.mode === 'READY' ? (
        <div
          className={styles.screenOverlay}
          role="region"
          aria-labelledby="tusin-start-title"
          data-game-state="READY"
          tabIndex={-1}
        >
          <div className={styles.startPanel}>
            <span className={styles.prototypeBadge}>INTERNAL FIRST PLAYABLE · MOCK REWARD ONLY</span>
            <h1 className={styles.title} id="tusin-start-title">투신전생기<br /><em>서바이벌</em></h1>
            <p className={styles.lead}>
              6분 동안 마신군의 전선을 돌파하고, 두 중간보스의 전리품으로 빌드를 완성한 뒤 마신군 선봉장을 직접 쓰러뜨리세요.
            </p>
            <div className={styles.startGrid}>
              <section className={styles.infoCard}>
                <h2>조작</h2>
                <ul className={styles.controlList}>
                  <li><span>이동</span><span className={styles.keycap}>WASD / 방향키</span></li>
                  <li><span>모바일</span><span className={styles.keycap}>화면 드래그</span></li>
                  <li><span>성장 선택</span><span className={styles.keycap}>1 · 2 · 3</span></li>
                  <li><span>일시정지</span><span className={styles.keycap}>ESC</span></li>
                </ul>
              </section>
              <section className={styles.infoCard}>
                <h2>이번 빌드에서 검증할 것</h2>
                <ul className={styles.controlList}>
                  <li><span>자동 무기 / 패시브</span><strong>6 + 6</strong></li>
                  <li><span>대응 조합 진화</span><strong>6종</strong></li>
                  <li><span>중간보스</span><strong>2체</strong></li>
                  <li><span>점수 / 보스 split</span><strong>RAW</strong></li>
                </ul>
              </section>
            </div>
            <div className={styles.seedRow}>
              <label htmlFor="tusin-seed">RUN SEED · 직접 수정 시 DEBUG</label>
              <input
                id="tusin-seed"
                className={styles.seedInput}
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
              />
              <button className={styles.smallButton} type="button" onClick={() => resetRuntime()}>무작위</button>
            </div>
            <div className={styles.buttonRow}>
              <button
                className={styles.primaryButton}
                type="button"
                data-state-primary
                onClick={() => {
                  if (seedInput.trim() !== snapshot.seed) resetRuntime(seedInput, true);
                  window.setTimeout(() => void onStart(), 0);
                }}
                disabled={!assetsReady || Boolean(assetError)}
              >
                {assetError ? '에셋 로드 실패' : assetsReady ? '최후의 전장 진입' : '도트 에셋 준비 중…'}
              </button>
              <span className={styles.testNotice}>실제 상품·구매권·재고는 지급되지 않습니다.</span>
            </div>
            {assetError ? <p className={styles.testNotice}>{assetError}</p> : null}
          </div>
        </div>
      ) : null}

      {snapshot.mode === 'LEVEL_UP' ? (
        <div
          className={styles.screenOverlay}
          role="region"
          aria-labelledby="level-up-title"
          data-game-state="LEVEL_UP"
          tabIndex={-1}
        >
          <div className={styles.modalPanel}>
            <aside className={styles.modalBuild}>
              <h2>현재 빌드</h2>
              <p className={styles.modalBuildLabel}>ACTIVE</p>
              <div className={styles.modalBuildGrid}><BuildSlots items={snapshot.build.actives} /></div>
              <p className={styles.modalBuildLabel}>PASSIVE</p>
              <div className={styles.modalBuildGrid}><BuildSlots items={snapshot.build.passives} /></div>
              <ul className={styles.statList}>
                <li><span>LEVEL</span><strong>{snapshot.player.level}</strong></li>
                <li><span>RAW SCORE</span><strong>{snapshot.score.rawScore.toLocaleString('ko-KR')}</strong></li>
                <li><span>KILLS</span><strong>{snapshot.score.kills}</strong></li>
              </ul>
            </aside>
            <div className={styles.modalContent}>
              <header className={styles.modalHeader}>
                <div>
                  <span className={styles.eyebrow}>전투 기억 공명</span>
                  <h2 id="level-up-title">새 힘을 선택하세요</h2>
                  <p>전장은 선택하는 동안 정지합니다. 숫자 1–3으로도 선택할 수 있습니다.</p>
                </div>
                <span className={styles.keycap}>LV {snapshot.player.level}</span>
              </header>
              <div className={styles.choiceList}>
                {snapshot.offers.map((offer, index) => (
                  <button
                    className={styles.choiceCard}
                    type="button"
                    key={`${offer.id}-${index}`}
                    data-state-primary={index === 0 ? true : undefined}
                    onClick={() => onChooseOffer(index)}
                  >
                    <span className={styles.choiceIcon}>
                      <AtlasVisual cell={abilityIconCell(displayIconId(offer.id))} label={offer.name} />
                    </span>
                    <span className={styles.choiceCopy}>
                      <strong>{index + 1}. {offer.name}</strong>
                      <span>{offer.description}</span>
                    </span>
                    <span className={styles.choiceType}>{offer.newSlot ? 'NEW' : `LV ${offer.nextLevel}`}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.mode === 'CHEST' ? (
        <div
          className={styles.screenOverlay}
          role="region"
          aria-labelledby="chest-title"
          data-game-state="CHEST"
          tabIndex={-1}
        >
          <div className={styles.transitionPanel}>
            <div className={styles.choiceIcon} style={{ width: '7rem', margin: '0 auto 1rem' }}>
              <AtlasVisual cell={pickupCell(snapshot.chest?.eligibleEvolutionIds.length ? 'evolution' : 'chest')} />
            </div>
            <span className={styles.eyebrow}>중간보스 전리품</span>
            <h2 id="chest-title">
              {snapshot.chest?.eligibleEvolutionIds.length ? '진화 조건이 완성되었습니다' : '보유 장비를 강화합니다'}
            </h2>
            <p>
              {snapshot.chest?.eligibleEvolutionIds.length
                ? `${EVOLUTION_NAMES[snapshot.chest.eligibleEvolutionIds[0]!] ?? snapshot.chest.eligibleEvolutionIds[0]}을(를) 해방할 수 있습니다.`
                : '완성된 진화식이 없어 보유 장비 중 하나를 강화합니다.'}
            </p>
            <div className={styles.buttonRow} style={{ justifyContent: 'center' }}>
              <button className={styles.primaryButton} type="button" data-state-primary onClick={onResolveChest}>전리품 열기</button>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.mode === 'FINAL_TRANSITION' ? (
        <div
          className={styles.screenOverlay}
          role="region"
          aria-labelledby="boss-title"
          data-game-state="FINAL_TRANSITION"
          tabIndex={-1}
        >
          <div className={styles.transitionPanel}>
            <div
              className={styles.bossPortrait}
              style={{ backgroundImage: `url(${tusinSurvivalAssetUrl('final-boss')})` }}
              aria-hidden="true"
            />
            <span className={styles.eyebrow}>6분 전선 종료 · 최종보스</span>
            <h2 id="boss-title">마신군 선봉장</h2>
            <p>일반 웨이브와 스테이지 시계가 멈췄습니다. 선봉장을 처치해야만 기록이 클리어로 확정됩니다.</p>
            <div className={styles.buttonRow} style={{ justifyContent: 'center' }}>
              <button className={styles.primaryButton} type="button" data-state-primary onClick={onContinueBoss}>최종 전투 시작</button>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot.mode === 'PAUSED' ? (
        <div
          className={styles.screenOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          ref={pauseDialogRef}
          tabIndex={-1}
        >
          <div className={styles.pausePanel}>
            <span className={styles.eyebrow}>PAUSED · {snapshot.seed}</span>
            <h2 id="pause-title">전투 일시정지</h2>
            <p>감각 옵션은 simulation과 점수 digest를 바꾸지 않습니다.</p>
            <div className={styles.pauseGrid}>
              <section className={styles.optionGroup}>
                <h2>음량</h2>
                <SettingsControls settings={settings} onChange={setSettings} />
              </section>
              <section className={styles.optionGroup}>
                <h2>런 상태</h2>
                <ul className={styles.statList}>
                  <li><span>시간</span><strong>{formatStageTime(snapshot)}</strong></li>
                  <li><span>점수</span><strong>{snapshot.score.rawScore.toLocaleString('ko-KR')}</strong></li>
                  <li><span>적 / 투사체</span><strong>{snapshot.metrics.enemyCount} / {snapshot.metrics.projectileCount}</strong></li>
                  <li><span>보상 연결</span><strong>DISABLED</strong></li>
                </ul>
              </section>
            </div>
            <div className={styles.buttonRow}>
              <button className={styles.primaryButton} type="button" data-state-primary onClick={onTogglePause}>전투 재개</button>
              <button className={styles.secondaryButton} type="button" onClick={() => resetRuntime(snapshot.seed, true)}>같은 시드 재시작 (DEBUG)</button>
              <button className={styles.secondaryButton} type="button" onClick={() => resetRuntime()}>새 시드</button>
            </div>
          </div>
        </div>
      ) : null}

      {resultMode ? (
        <div
          className={styles.screenOverlay}
          role="region"
          aria-labelledby="result-title"
          data-game-state={snapshot.mode}
          tabIndex={-1}
        >
          <div className={styles.resultPanel}>
            <span className={styles.eyebrow}>{verificationLabel}</span>
            <h2 id="result-title">{canonicalResult?.state === 'RESULTS_CLEAR' ? '선봉장을 쓰러뜨렸습니다' : '최후의 전선이 무너졌습니다'}</h2>
            <p>seed {snapshot.seed} · 무작위 seed 간 난이도 보정 없이 raw score와 실제 시간을 비교합니다.</p>
            <div className={styles.resultScore}>
              <strong>{(canonicalResult?.rawScore ?? snapshot.score.rawScore).toLocaleString('ko-KR')}</strong>
              <span>RAW SCORE {currentScoreRank > 0 ? `· #${currentScoreRank}` : ''}</span>
            </div>
            <div className={styles.resultGrid}>
              <section className={styles.resultCard}>
                <h2>런 기록</h2>
                <ul className={styles.statList}>
                  <li><span>처치</span><strong>{canonicalResult?.kills ?? snapshot.score.kills}</strong></li>
                  <li><span>레벨</span><strong>{canonicalResult?.player.level ?? snapshot.player.level}</strong></li>
                  <li><span>중간보스</span><strong>{midbossKills} / 2</strong></li>
                  {(canonicalResult?.bosses ?? snapshot.score.bosses.map((boss) => ({
                    id: boss.id,
                    kind: boss.role,
                    spawnTick: boss.spawnTick,
                    killTick: boss.killTick,
                  })))
                    .filter((boss) => boss.kind === 'MID_BOSS')
                    .map((boss) => (
                      <li key={boss.id}>
                        <span>{bossMilestoneName(boss.id)} split</span>
                        <strong>
                          {boss.killTick === null
                            ? '미처치'
                            : formatTicks(boss.killTick - boss.spawnTick)}
                        </strong>
                      </li>
                    ))}
                  <li><span>최종보스 split</span><strong>{formatTicks(canonicalResult?.bossSplitTicks ?? snapshot.score.bossSplitTicks)}</strong></li>
                  <li><span>전체 simulation</span><strong>{formatTicks(canonicalResult?.completionTicks ?? snapshot.tick)}</strong></li>
                  <li>
                    <span>replay digest</span>
                    <strong>{replayVerification.outcome?.stateDigest ?? replayVerification.status}</strong>
                  </li>
                  <li><span>debug run</span><strong>{snapshot.debug.active ? '제외' : '정상'}</strong></li>
                </ul>
                <h2 style={{ marginTop: '1rem' }}>무기별 피해</h2>
                <ul className={styles.statList}>
                  {Object.entries(canonicalResult?.weaponDamage ?? snapshot.score.weaponDamage)
                    .sort((left, right) => right[1] - left[1])
                    .slice(0, 6)
                    .map(([weaponId, damage]) => (
                      <li key={weaponId}>
                        <span>{tusinSurvivalPack.actives.find((active) => active.id === weaponId)?.name.text ?? weaponId}</span>
                        <strong>{Math.round(damage).toLocaleString('ko-KR')}</strong>
                      </li>
                    ))}
                </ul>
              </section>

              <section className={styles.resultCard}>
                <h2>누적 mock 보상</h2>
                {mockRewards.excluded ? (
                  <p className={styles.testNotice}>
                    {mockRewards.exclusionReason === 'debug_run'
                      ? '디버그가 사용된 런은 순위와 모든 mock 보상에서 제외됩니다.'
                      : 'replay 검증이 완료되지 않은 런은 순위와 모든 mock 보상에서 제외됩니다.'}
                  </p>
                ) : mockRewards.awards.length ? (
                  <ul className={styles.rewardList}>
                    {mockRewards.awards.map((award) => (
                      <li key={award.rule}>
                        <span className={styles.rewardState}>{award.provisional ? '잠정' : 'MOCK'}</span>
                        <span className={styles.rewardCopy}>
                          <strong>{award.label}</strong>
                          <span>
                            {award.notice}
                            {award.reviewStatus === 'manual_review'
                              ? ` · ${award.evidence.reviewWindowHours}시간 수동 검수 · 수령 ${award.evidence.claimWindowDays}일 · ${award.evidence.unclaimedPolicy === 'next-ranked' ? '미수령 시 차순위 승계' : '미수령 정책 미정'} · ${award.evidence.shippingPayer === 'operator' ? '배송비 운영자 부담' : '배송비 정책 미정'} 가정`
                              : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.testNotice}>충족한 mock 보상 조건이 없습니다.</p>
                )}
                <p className={styles.testNotice}>실제 지급·구매·재고·배송 기능은 코드에서 비활성 상태입니다.</p>
              </section>

              <section className={styles.resultCard}>
                <h2>로컬 리더보드</h2>
                <div className={styles.leaderboardTabs}>
                  <button
                    className={`${styles.smallButton} ${leaderboardView === 'score' ? styles.toggleOn : ''}`}
                    type="button"
                    onClick={() => setLeaderboardView('score')}
                  >
                    RAW SCORE
                  </button>
                  <button
                    className={`${styles.smallButton} ${leaderboardView === 'speedrun' ? styles.toggleOn : ''}`}
                    type="button"
                    onClick={() => setLeaderboardView('speedrun')}
                  >
                    BOSS SPEEDRUN
                  </button>
                </div>
                <table className={styles.leaderboardTable}>
                  <thead><tr><th>#</th><th>SEED</th><th>SCORE</th><th>SPLIT</th></tr></thead>
                  <tbody>
                    {visibleLeaderboard.slice(0, 5).map((record, index) => (
                      <tr className={record.id === currentRecordId ? styles.currentRecord : ''} key={record.id}>
                        <td>{index + 1}</td>
                        <td>{record.seed.slice(0, 14)}</td>
                        <td>{record.rawScore.toLocaleString('ko-KR')}</td>
                        <td>{formatTicks(record.bossSplitTicks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className={styles.resultCard}>
                <h2>최종 빌드</h2>
                <div className={styles.buildHeading}><span>ACTIVE</span><span>{canonicalResult?.build.actives.length ?? snapshot.build.actives.length}/6</span></div>
                <BuildSlots items={canonicalResult?.build.actives ?? snapshot.build.actives} />
                <div className={styles.buildHeading}><span>PASSIVE</span><span>{canonicalResult?.build.passives.length ?? snapshot.build.passives.length}/6</span></div>
                <BuildSlots items={canonicalResult?.build.passives ?? snapshot.build.passives} />
              </section>
            </div>
            <div className={styles.resultActions}>
              <button className={styles.primaryButton} type="button" data-state-primary onClick={() => resetRuntime()}>새 시드로 다시 도전</button>
              <button className={styles.secondaryButton} type="button" onClick={() => resetRuntime(snapshot.seed, true)}>같은 시드 재도전 (DEBUG)</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.visuallyHidden} aria-live="polite">
        {snapshot.mode === 'LEVEL_UP' ? '레벨업 선택 화면입니다.' : null}
        {snapshot.mode === 'FINAL_TRANSITION' ? '최종보스 마신군 선봉장이 등장했습니다.' : null}
        {resultMode ? `런 종료. 점수 ${canonicalResult?.rawScore ?? snapshot.score.rawScore}. ${verificationLabel}` : null}
      </div>
    </section>
  );
}
