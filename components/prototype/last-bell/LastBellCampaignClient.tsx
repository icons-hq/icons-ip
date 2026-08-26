'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { LAST_BELL_VERIFIED_EXPERIENCE_PATH } from '@/lib/campaigns/aouad/game-entry';
import { LAST_BELL_PRODUCT_CATALOG } from '@/lib/campaigns/aouad/last-bell-products';
import {
  LAST_BELL_CHAPTER_COPY,
  hidesGameplayHudAtRooftop,
  objectiveCopyForLastBell,
} from '@/lib/prototypes/last-bell/narrative';
import { LastBellSimulation } from '@/lib/prototypes/last-bell/runtime/simulation';
import { shouldUseLastBellTouchHud } from '@/lib/prototypes/last-bell/runtime/touch-hud';
import type {
  ChapterId,
  CollectibleKey,
  LastBellInfectionForeshadowing,
  LastBellRuntimeEvent,
  LastBellSimulationSnapshot,
} from '@/lib/prototypes/last-bell/runtime/types';
import type { LastBellCampaignInteractionCommand } from './LastBellCampaignRuntime';
import {
  LAST_BELL_QA_NAMRA_HYBRID_MODES,
  type LastBellQaNamraHybridMode,
} from './scene/campaign/campaignAssets';
import type { LastBellCampaignAssetKey } from './scene/campaign/campaignStreaming';
import type { LastBellOpeningAssetStatus } from './scene/AuthoredEnvironment3d';
import { EntryOverlay } from './EntryOverlay';
import { LastBellInventoryPanel } from './LastBellInventoryPanel';
import {
  LocalRunHost,
  resolveLastBellRunResume,
  VerifiedRunHost,
  type LastBellRunAuthority,
  type LastBellRunHostStatus,
} from './LastBellRunHost';
import { RooftopEndingOverlay } from './RooftopEndingOverlay';
import styles from './last-bell.module.css';

const LastBellCampaignRuntime = dynamic(
  () => import('./LastBellCampaignRuntime').then((module) => module.LastBellCampaignRuntime),
  { ssr: false, loading: () => <div aria-label="효산고 3D 공간을 불러오는 중" /> },
);

type InputVector = { x: number; y: number };
type RunMode = 'first-play' | 'chapter-replay';
type CompletionCandidate = Readonly<{
  committedCollectibles: readonly CollectibleKey[];
  chapterReplayExit: boolean;
}>;

export type LastBellCampaignClientProps = Readonly<{
  authority: LastBellRunAuthority;
  isAuthenticated: boolean;
  authConfigured: boolean;
}>;

const LOCAL_INVENTORY_KEY = 'icons.last-bell.local-inventory.v1';
const LAST_BELL_GAMEPLAY_AUDIO = {
  ambience: '/generated/last-bell/audio/last-classroom-drone.ogg',
  footsteps: '/generated/last-bell/audio/corridor-footsteps.wav',
  infected: '/generated/last-bell/audio/distant-infected-groan.ogg',
  breaker: '/generated/last-bell/audio/breaker-switch-electric.wav',
  noiseDevice: '/generated/last-bell/audio/outbreak-door-pounding.wav',
  lastBell: '/generated/last-bell/audio/school-bell-malfunction.wav',
  hiddenBreath: '/generated/last-bell/audio/breath-heartbeat-loop.ogg',
  hideCloth: '/generated/last-bell/audio/corridor-footsteps.wav',
} as const;

const LAST_BELL_FORESHADOWING_CUES: Record<LastBellInfectionForeshadowing, { copy: string; audio: string; volume: number }> = {
  strength: { copy: '부러진 금속을 한 손으로 밀어냈다.', audio: LAST_BELL_GAMEPLAY_AUDIO.breaker, volume: .3 },
  'scent-hesitation': { copy: '감염자가 잠깐, 낯선 냄새를 따라 멈췄다.', audio: LAST_BELL_GAMEPLAY_AUDIO.infected, volume: .16 },
  'rapid-recovery': { copy: '시야가 꺾였다가 너무 빨리 돌아왔다.', audio: '/generated/last-bell/audio/breath-heartbeat-loop.ogg', volume: .14 },
};

function initialSnapshot() {
  return new LastBellSimulation().snapshot();
}

function formatClock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function uniqueKeys(keys: readonly CollectibleKey[]) {
  return [...new Set(keys)].sort() as CollectibleKey[];
}

function localQaNamraHybridMode(): LastBellQaNamraHybridMode | null {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null;
  const candidate = new URLSearchParams(window.location.search).get('qaNamraHybrid');
  return candidate && (LAST_BELL_QA_NAMRA_HYBRID_MODES as readonly string[]).includes(candidate)
    ? candidate as LastBellQaNamraHybridMode
    : null;
}

type LastBellEntryQa = Readonly<{
  sceneReady: boolean;
  starting: boolean;
  skipPending: boolean;
  entryPhase: 'preflight' | 'cold-open' | 'playing';
  openingHandoffNonce: number;
  doorInteractionReady: boolean;
  sceneReadyAtMs: number | null;
  activationRequestedAtMs: number | null;
  openingHandoffAtMs: number | null;
  doorInteractionAtMs: number | null;
  readyToDoorMs: number | null;
}>;

function publishEntryQa(entry: LastBellEntryQa) {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('qa')) return;
  const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
  scope.__ICONS_LAST_BELL_QA__ = { ...scope.__ICONS_LAST_BELL_QA__, entry };
}

function gamepadInput(): Readonly<{ movement: InputVector; running: boolean }> {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return { movement: { x: 0, y: 0 }, running: false };
  const pad = [...navigator.getGamepads()].find((candidate) => candidate?.connected);
  if (!pad) return { movement: { x: 0, y: 0 }, running: false };
  const deadZone = (value: number) => Math.abs(value) >= .16 ? value : 0;
  return {
    movement: { x: deadZone(pad.axes[0] ?? 0), y: -deadZone(pad.axes[1] ?? 0) },
    running: Boolean(pad.buttons[4]?.pressed || pad.buttons[5]?.pressed || pad.buttons[7]?.pressed),
  };
}

export function LastBellCampaignClient({ authority, isAuthenticated, authConfigured }: LastBellCampaignClientProps) {
  const qaNamraHybridMode = useMemo(() => localQaNamraHybridMode(), []);
  const qaStartsAtRooftop = qaNamraHybridMode !== null;
  const [snapshot, setSnapshot] = useState<LastBellSimulationSnapshot>(initialSnapshot);
  const [sceneReady, setSceneReady] = useState(false);
  const [entryPhase, setEntryPhase] = useState<'preflight' | 'cold-open' | 'playing'>('preflight');
  const [entrySettingsOpen, setEntrySettingsOpen] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [crouching, setCrouching] = useState(false);
  const [touchHud, setTouchHud] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [openingHandoffNonce, setOpeningHandoffNonce] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [assetRetryNonce, setAssetRetryNonce] = useState(0);
  const [routeAssetStatus, setRouteAssetStatus] = useState<Readonly<{
    failedAssetKeys: readonly LastBellCampaignAssetKey[];
    criticalAssetFailure: boolean;
  }>>({ failedAssetKeys: [], criticalAssetFailure: false });
  const [openingAssetStatus, setOpeningAssetStatus] = useState<LastBellOpeningAssetStatus>({
    failedAssetKeys: [], criticalAssetFailure: false,
  });
  const [interactionCommand, setInteractionCommand] = useState<LastBellCampaignInteractionCommand | null>(null);
  const [initialChapter, setInitialChapter] = useState<ChapterId>(() => qaStartsAtRooftop ? 'chapter-02' : 'chapter-01');
  const [runMode, setRunMode] = useState<RunMode>(() => qaStartsAtRooftop ? 'chapter-replay' : 'first-play');
  const [progressStage, setProgressStage] = useState(0);
  const [committed, setCommitted] = useState<CollectibleKey[]>([]);
  const [resumePending, setResumePending] = useState<CollectibleKey[]>([]);
  const [pickupToast, setPickupToast] = useState<CollectibleKey | null>(null);
  const [foreshadowingCue, setForeshadowingCue] = useState<LastBellInfectionForeshadowing | null>(null);
  const [hostStatus, setHostStatus] = useState<LastBellRunHostStatus>({ state: 'idle', runId: null, message: null });
  const [replayComplete, setReplayComplete] = useState(false);
  const [completionCandidate, setCompletionCandidate] = useState<CompletionCandidate | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const moveRef = useRef<InputVector>({ x: 0, y: 0 });
  const lookRef = useRef<InputVector>({ x: 0, y: 0 });
  const runRef = useRef(false);
  const pressedRef = useRef(new Set<string>());
  const interactionNonceRef = useRef(0);
  const pointerWasLockedRef = useRef(false);
  const lookPointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const oneShotsRef = useRef(new Set<HTMLAudioElement>());
  const entryQaTimesRef = useRef<{
    sceneReadyAtMs: number | null;
    activationRequestedAtMs: number | null;
    openingHandoffAtMs: number | null;
    doorInteractionAtMs: number | null;
  }>({ sceneReadyAtMs: null, activationRequestedAtMs: null, openingHandoffAtMs: null, doorInteractionAtMs: null });

  const playOneShot = useCallback((source: string, volume: number) => {
    const audio = new Audio(source);
    audio.volume = volume;
    oneShotsRef.current.add(audio);
    const release = () => oneShotsRef.current.delete(audio);
    audio.addEventListener('ended', release, { once: true });
    void audio.play().catch(release);
  }, []);

  useEffect(() => () => {
    for (const audio of oneShotsRef.current) {
      audio.pause();
      audio.currentTime = 0;
    }
    oneShotsRef.current.clear();
  }, []);

  const host = useMemo(() => authority === 'verified-candidate'
    ? new VerifiedRunHost(setHostStatus)
    : new LocalRunHost(), [authority]);

  const refreshMovement = useCallback(() => {
    const pressed = pressedRef.current;
    const gamepad = gamepadInput();
    const x = Number(pressed.has('KeyD')) - Number(pressed.has('KeyA')) + gamepad.movement.x;
    const y = Number(pressed.has('KeyW')) - Number(pressed.has('KeyS')) + gamepad.movement.y;
    moveRef.current = {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
    runRef.current = pressed.has('ShiftLeft') || pressed.has('ShiftRight') || gamepad.running;
  }, []);

  const resetInputLatches = useCallback(() => {
    pressedRef.current.clear();
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    lookPointerRef.current = null;
    setListening(false);
    setCrouching(false);
  }, []);

  const completeOpeningHandoff = useCallback(() => {
    resetInputLatches();
    entryQaTimesRef.current.openingHandoffAtMs ??= performance.now();
    setSkipPending(false);
    setOpeningHandoffNonce((value) => value + 1);
    setEntryPhase('playing');
  }, [resetInputLatches]);

  const handleSceneReady = useCallback(() => {
    entryQaTimesRef.current.sceneReadyAtMs ??= performance.now();
    setSceneReady(true);
  }, []);

  const triggerInteraction = useCallback(() => {
    const interaction = snapshot.availableInteractions[0];
    if (!interaction || !interaction.enabled) return;
    interactionNonceRef.current += 1;
    setInteractionCommand({ interactionId: interaction.id, nonce: interactionNonceRef.current });
  }, [snapshot.availableInteractions]);

  useEffect(() => {
    const timer = window.setInterval(refreshMovement, 50);
    return () => window.clearInterval(timer);
  }, [refreshMovement]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(pointer: coarse)');
    const update = () => {
      setReducedMotion(motion.matches);
      setTouchHud(shouldUseLastBellTouchHud({
        pointerCoarse: pointer.matches,
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    update();
    motion.addEventListener('change', update);
    pointer.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      motion.removeEventListener('change', update);
      pointer.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (authority !== 'local-qa') return;
    let cancelled = false;
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_INVENTORY_KEY) ?? '[]') as unknown;
      if (Array.isArray(parsed)) {
        const restored = uniqueKeys(parsed.filter((key): key is CollectibleKey => typeof key === 'string'));
        queueMicrotask(() => { if (!cancelled) setCommitted(restored); });
      }
    } catch { /* Local QA records are intentionally disposable. */ }
    return () => { cancelled = true; };
  }, [authority]);

  useEffect(() => {
    if (authority !== 'verified-candidate' || !isAuthenticated) return;
    void host.loadInventory().then((keys) => setCommitted(uniqueKeys(keys))).catch(() => undefined);
  }, [authority, host, isAuthenticated]);

  useEffect(() => {
    if (authority !== 'verified-candidate' || !isAuthenticated) return;
    const url = new URL(window.location.href);
    const claimRunId = url.searchParams.get('claimRunId');
    if (!claimRunId) return;
    void host.claim(claimRunId).then(async () => {
      setCommitted(uniqueKeys(await host.loadInventory()));
      url.searchParams.delete('claimRunId');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }).catch(() => setHostStatus({ state: 'error', runId: claimRunId, message: 'claim_failed' }));
  }, [authority, host, isAuthenticated]);

  useEffect(() => {
    if (!pickupToast) return;
    const timer = window.setTimeout(() => setPickupToast(null), 1150);
    return () => window.clearTimeout(timer);
  }, [pickupToast]);

  useEffect(() => {
    if (!foreshadowingCue) return undefined;
    const timer = window.setTimeout(() => setForeshadowingCue(null), 2_200);
    return () => window.clearTimeout(timer);
  }, [foreshadowingCue]);

  const hideHud = hidesGameplayHudAtRooftop(snapshot.rooftopPhase);

  useEffect(() => {
    if (!started || entryPhase !== 'playing' || paused || inventoryOpen || contextLost || snapshot.rooftopPhase !== 'sealed') return undefined;
    const ambience = new Audio(LAST_BELL_GAMEPLAY_AUDIO.ambience);
    ambience.loop = true;
    ambience.volume = snapshot.chapterId === 'chapter-01' ? .16 : .09;
    void ambience.play().catch(() => undefined);
    return () => {
      ambience.pause();
      ambience.currentTime = 0;
    };
  }, [contextLost, entryPhase, inventoryOpen, paused, snapshot.chapterId, snapshot.rooftopPhase, started]);

  useEffect(() => {
    if (!started || entryPhase !== 'playing' || paused || inventoryOpen || contextLost || snapshot.gameComplete) return undefined;
    const footsteps = new Audio(LAST_BELL_GAMEPLAY_AUDIO.footsteps);
    footsteps.loop = true;
    footsteps.volume = .13;
    let playing = false;
    const update = () => {
      const moving = Math.hypot(moveRef.current.x, moveRef.current.y) > .1 && !snapshot.player.hiding;
      footsteps.playbackRate = runRef.current ? 1.36 : .92;
      footsteps.volume = runRef.current ? .2 : .12;
      if (moving && !playing) {
        playing = true;
        void footsteps.play().catch(() => { playing = false; });
      } else if (!moving && playing) {
        playing = false;
        footsteps.pause();
      }
    };
    const timer = window.setInterval(update, 80);
    return () => {
      window.clearInterval(timer);
      footsteps.pause();
      footsteps.currentTime = 0;
    };
  }, [contextLost, entryPhase, inventoryOpen, paused, snapshot.gameComplete, snapshot.player.hiding, started]);

  useEffect(() => {
    const state = snapshot.player.stealthState;
    if (state === 'entering-hide' || state === 'exiting-hide') playOneShot(LAST_BELL_GAMEPLAY_AUDIO.hideCloth, .1);
    if (state !== 'hidden' || paused || inventoryOpen || contextLost || !started || entryPhase !== 'playing') return undefined;
    const breath = new Audio(LAST_BELL_GAMEPLAY_AUDIO.hiddenBreath);
    breath.loop = true;
    breath.volume = .1;
    void breath.play().catch(() => undefined);
    return () => { breath.pause(); breath.currentTime = 0; };
  }, [contextLost, entryPhase, inventoryOpen, paused, playOneShot, snapshot.player.stealthState, started]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!document.pointerLockElement || paused || inventoryOpen) return;
      lookRef.current.x += event.movementX;
      lookRef.current.y += event.movementY;
    };
    const onPointerLock = () => {
      const locked = document.pointerLockElement !== null;
      if (locked) pointerWasLockedRef.current = true;
      else if (pointerWasLockedRef.current && started && entryPhase === 'playing' && !inventoryOpen) setPaused(true);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLock);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLock);
    };
  }, [entryPhase, inventoryOpen, paused, started]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Tab' && started && entryPhase === 'playing' && !hideHud) {
        event.preventDefault();
        setInventoryOpen((open) => !open);
        setPaused(false);
        document.exitPointerLock?.();
        return;
      }
      if (event.code === 'Escape') {
        if (inventoryOpen) {
          setInventoryOpen(false);
          setPaused(false);
        }
        else if (started && entryPhase === 'playing') setPaused((value) => !value);
        return;
      }
      if (!started || entryPhase !== 'playing' || paused || inventoryOpen || snapshot.gameComplete) return;
      pressedRef.current.add(event.code);
      refreshMovement();
      if (event.repeat) return;
      if (event.code === 'KeyE') triggerInteraction();
      if (event.code === 'KeyF') setFlashlightOn((value) => !value);
      if (event.code === 'KeyQ') setListening(true);
      if (event.code === 'KeyC') setCrouching((value) => !value);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedRef.current.delete(event.code);
      refreshMovement();
      if (event.code === 'KeyQ') setListening(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [entryPhase, hideHud, inventoryOpen, paused, refreshMovement, snapshot.gameComplete, started, triggerInteraction]);

  const finalizeRun = useCallback(async (candidate: CompletionCandidate) => {
    if (authority === 'local-qa') {
      const nextCommitted = uniqueKeys(candidate.committedCollectibles);
      setCommitted(nextCommitted);
      localStorage.setItem(LOCAL_INVENTORY_KEY, JSON.stringify(nextCommitted));
    }
    try {
      await host.complete();
      setHostStatus(host.status());
      if (authority === 'verified-candidate') {
        setCommitted(isAuthenticated
          ? uniqueKeys(await host.loadInventory())
          : uniqueKeys(candidate.committedCollectibles));
      }
    } catch {
      setHostStatus(host.status());
    }
  }, [authority, host, isAuthenticated]);

  const startRun = useCallback(async (chapterId: ChapterId, nextMode: RunMode) => {
    setStarting(true);
    resetInputLatches();
    setReplayComplete(false);
    setCompletionCandidate(null);
    try {
      const result = await host.start(chapterId, nextMode);
      const resolution = resolveLastBellRunResume(result);
      const terminalCandidate: CompletionCandidate | null = resolution.terminal
        ? {
          committedCollectibles: uniqueKeys([...committed, ...result.pickedCollectibles]),
          chapterReplayExit: resolution.terminal === 'chapter-exit',
        }
        : null;
      setHostStatus(host.status());
      setResumePending([...result.pickedCollectibles]);
      setInitialChapter(resolution.restoredChapter);
      setRunMode(result.runMode);
      setProgressStage(result.progressStage);
      setStarted(true);
      setPaused(false);
      setInventoryOpen(false);
      setFlashlightOn(true);
      if (terminalCandidate) {
        setCompletionCandidate(terminalCandidate);
        setReplayComplete(terminalCandidate.chapterReplayExit);
      }
      setEntryPhase(!result.resumed && result.runMode === 'first-play' && resolution.restoredChapter === 'chapter-01' ? 'cold-open' : 'playing');
      setResetNonce((value) => value + 1);
      if (terminalCandidate) void finalizeRun(terminalCandidate);
    } finally {
      setStarting(false);
    }
  }, [committed, finalizeRun, host, resetInputLatches]);

  useEffect(() => {
    if (!started || entryPhase !== 'cold-open') return;
    const timer = window.setTimeout(() => {
      completeOpeningHandoff();
    }, 18_000);
    return () => window.clearTimeout(timer);
  }, [completeOpeningHandoff, entryPhase, started]);

  const skipOpening = useCallback(() => {
    resetInputLatches();
    entryQaTimesRef.current.activationRequestedAtMs = performance.now();
    if (sceneReady && !starting) completeOpeningHandoff();
    else setSkipPending(true);
  }, [completeOpeningHandoff, resetInputLatches, sceneReady, starting]);

  useEffect(() => {
    if (!skipPending || !sceneReady || starting) return;
    const timer = window.setTimeout(() => {
      completeOpeningHandoff();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [completeOpeningHandoff, sceneReady, skipPending, starting]);

  const retryFromCapture = useCallback(() => {
    // The retry nonce resets the simulation on the next committed R3F effect.
    // Clear held keys first so that same-frame movement cannot move the fresh
    // checkpoint back into the first infected's capture radius.
    resetInputLatches();
    setCrouching(false);
    setRetryNonce((value) => value + 1);
  }, [resetInputLatches]);

  const onRuntimeEvent = useCallback((event: LastBellRuntimeEvent, current: LastBellSimulationSnapshot) => {
    host.record(event, current);
    setHostStatus(host.status());
    if (event.type === 'foreshadowing') {
      const cue = LAST_BELL_FORESHADOWING_CUES[event.cue];
      setForeshadowingCue(event.cue);
      playOneShot(cue.audio, cue.volume);
    }
    if (event.type === 'pickup') setPickupToast(event.collectibleKey);
    // The authored rooftop portal is a synchronous interaction event, so
    // close all normal-game UI before the next snapshot can render its ending.
    if (event.type === 'objective' && event.objectiveId === 'ch2.approach-namra') {
      setInventoryOpen(false);
      setPickupToast(null);
      setListening(false);
      setCrouching(false);
      pressedRef.current.clear();
      refreshMovement();
      moveRef.current = { x: 0, y: 0 };
      runRef.current = false;
    }
    if (event.type === 'objective' && event.objectiveId === 'ch1.deploy-noise-device') playOneShot(LAST_BELL_GAMEPLAY_AUDIO.breaker, .42);
    if (event.type === 'objective' && event.objectiveId === 'ch1.open-fire-door') playOneShot(LAST_BELL_GAMEPLAY_AUDIO.noiseDevice, .4);
    if (event.type === 'objective' && event.objectiveId === 'ch1.ring-last-bell') playOneShot(LAST_BELL_GAMEPLAY_AUDIO.lastBell, .46);
    const chapterReplayExit = event.type === 'chapter_complete'
      && runMode === 'chapter-replay'
      && event.chapterId === 'chapter-01';
    if (event.type === 'game_complete' || chapterReplayExit) {
      const candidate: CompletionCandidate = {
        committedCollectibles: uniqueKeys(current.committedCollectibles),
        chapterReplayExit,
      };
      setCompletionCandidate(candidate);
      if (chapterReplayExit) setReplayComplete(true);
      void finalizeRun(candidate);
    }
  }, [finalizeRun, host, playOneShot, refreshMovement, runMode]);

  const readFrameInput = useCallback(() => {
    const look = lookRef.current;
    lookRef.current = { x: 0, y: 0 };
    return { movement: moveRef.current, look, running: runRef.current };
  }, []);

  const onCanvasInteract = useCallback(() => {
    if (touchHud || entryPhase !== 'playing' || paused || inventoryOpen) return;
    const canvas = rootRef.current?.querySelector('canvas');
    if (canvas && document.pointerLockElement !== canvas) void canvas.requestPointerLock();
  }, [entryPhase, inventoryOpen, paused, touchHud]);

  const onAssetStatus = useCallback((next: Readonly<{
    failedAssetKeys: readonly LastBellCampaignAssetKey[];
    criticalAssetFailure: boolean;
  }>) => {
    setRouteAssetStatus((previous) => (
      previous.criticalAssetFailure === next.criticalAssetFailure
      && previous.failedAssetKeys.join(':') === next.failedAssetKeys.join(':')
        ? previous
        : next
    ));
  }, []);

  const onOpeningAssetStatus = useCallback((next: LastBellOpeningAssetStatus) => {
    setOpeningAssetStatus((previous) => (
      previous.criticalAssetFailure === next.criticalAssetFailure
      && previous.failedAssetKeys.join(':') === next.failedAssetKeys.join(':')
        ? previous
        : next
    ));
  }, []);

  const assetStatus = useMemo(() => ({
    failedAssetKeys: [...new Set([...openingAssetStatus.failedAssetKeys, ...routeAssetStatus.failedAssetKeys])],
    criticalAssetFailure: openingAssetStatus.criticalAssetFailure || routeAssetStatus.criticalAssetFailure,
  }), [openingAssetStatus, routeAssetStatus]);

  const active = started && !paused && !inventoryOpen && !snapshot.captured && !snapshot.gameComplete && !replayComplete && !contextLost && !assetStatus.criticalAssetFailure;
  const interaction = snapshot.availableInteractions[0] ?? null;
  const doorInteractionReady = entryPhase === 'playing'
    && interaction?.id === 'ch1.classroom-door.open'
    && interaction.enabled;
  const interactionPrompt = interaction?.kind === 'locker-hide' && snapshot.player.hidingSpotId
    ? snapshot.player.stealthState === 'hidden'
      ? '은신처에서 나오기'
      : '몸을 숨기는 중'
    : interaction?.prompt;
  const totalElapsed = snapshot.elapsedSeconds + (initialChapter === 'chapter-02' ? 425 : 0);
  const toastItem = pickupToast ? LAST_BELL_PRODUCT_CATALOG.find((item) => item.key === pickupToast) : null;
  const claimHref = hostStatus.runId
    ? `/login?next=${encodeURIComponent(`${LAST_BELL_VERIFIED_EXPERIENCE_PATH}?claimRunId=${hostStatus.runId}`)}`
    : undefined;
  const rootStyle = { '--scene-brightness': brightness / 100 } as CSSProperties;

  useEffect(() => {
    if (doorInteractionReady) entryQaTimesRef.current.doorInteractionAtMs ??= performance.now();
    const times = entryQaTimesRef.current;
    publishEntryQa({
      sceneReady,
      starting,
      skipPending,
      entryPhase,
      openingHandoffNonce,
      doorInteractionReady,
      sceneReadyAtMs: times.sceneReadyAtMs,
      activationRequestedAtMs: times.activationRequestedAtMs,
      openingHandoffAtMs: times.openingHandoffAtMs,
      doorInteractionAtMs: times.doorInteractionAtMs,
      readyToDoorMs: times.sceneReadyAtMs !== null && times.activationRequestedAtMs !== null && times.doorInteractionAtMs !== null
        ? Number((times.doorInteractionAtMs - Math.max(times.sceneReadyAtMs, times.activationRequestedAtMs)).toFixed(2))
        : null,
    });
  }, [doorInteractionReady, entryPhase, openingHandoffNonce, sceneReady, skipPending, starting]);

  const setTouchMove = (next: InputVector) => { moveRef.current = next; };
  const clearTouchMove = () => { moveRef.current = { x: 0, y: 0 }; };
  const setTouchRun = (running: boolean) => { runRef.current = running; };
  const beginTouchLook = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    lookPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const moveTouchLook = (event: PointerEvent<HTMLDivElement>) => {
    const previous = lookPointerRef.current;
    if (!previous || previous.id !== event.pointerId) return;
    lookRef.current.x += (event.clientX - previous.x) * 1.45;
    lookRef.current.y += (event.clientY - previous.y) * 1.25;
    lookPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  return (
    <main ref={rootRef} className={styles.root} style={rootStyle} data-reduced-motion={reducedMotion} data-campaign-runtime="two-chapter">
      <div className={styles.scene}>
        <LastBellCampaignRuntime
          initialChapter={initialChapter}
          runMode={runMode}
          progressStage={progressStage}
          committedCollectibles={committed}
          pendingCollectibles={resumePending}
          readFrameInput={readFrameInput}
          active={active}
          entryPhase={entryPhase}
          flashlightOn={flashlightOn}
          listening={listening}
          crouching={crouching}
          resetNonce={resetNonce}
          openingHandoffNonce={openingHandoffNonce}
          retryNonce={retryNonce}
          assetRetryNonce={assetRetryNonce}
          interactionCommand={interactionCommand}
          reducedMotion={reducedMotion}
          onSceneReady={handleSceneReady}
          onSnapshot={setSnapshot}
          onEvent={onRuntimeEvent}
          onCanvasInteract={onCanvasInteract}
          onAssetStatus={onAssetStatus}
          onOpeningAssetStatus={onOpeningAssetStatus}
          onContextState={(state) => setContextLost(state === 'lost')}
          qaNamraHybridMode={qaNamraHybridMode}
        />
      </div>

      <EntryOverlay
        phase={entryPhase}
        sceneReady={sceneReady && !starting}
        hasCheckpoint={false}
        settings={(
          <div className={styles.comfortSettings}>
            <label>밝기 <output>{brightness}%</output><input type="range" min="70" max="130" step="10" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
            <label className={styles.comfortCheck}><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> 화면 움직임 줄이기</label>
          </div>
        )}
        onStart={() => void startRun(qaStartsAtRooftop ? 'chapter-02' : 'chapter-01', qaStartsAtRooftop ? 'chapter-replay' : 'first-play')}
        onSkip={skipOpening}
        onToggleSettings={() => setEntrySettingsOpen((value) => !value)}
        settingsOpen={entrySettingsOpen}
      />

      {assetStatus.failedAssetKeys.length > 0 ? (
        <aside className={styles.campaignAssetStatus} role="status">
          <p>{assetStatus.criticalAssetFailure
            ? '필수 3D 연출을 불러오지 못해 이 구간을 안전하게 일시 중지했습니다. 다시 시도해 주세요.'
            : '일부 3D 자산을 불러오지 못했습니다.'}</p>
          <button type="button" className={styles.ghostButton} onClick={() => setAssetRetryNonce((value) => value + 1)}>3D 자산 다시 불러오기</button>
        </aside>
      ) : null}

      {!hideHud && started ? (
        <section className={styles.campaignHud} aria-label="게임 상태">
          <div className={styles.campaignObjective}>
            <span>{LAST_BELL_CHAPTER_COPY[snapshot.chapterId].number} · {LAST_BELL_CHAPTER_COPY[snapshot.chapterId].title}</span>
            <strong>{objectiveCopyForLastBell(snapshot.objectiveId)}</strong>
            <p className={styles.campaignPacing} data-ready={snapshot.pacing.ready}>{snapshot.pacing.instruction}</p>
          </div>
          <div className={styles.campaignMeta}>
            <span>{formatClock(totalElapsed)} / 10:00</span>
            <span>{snapshot.collectedThisRun.length + snapshot.committedCollectibles.length}/10 수집</span>
            <span data-sync={hostStatus.state}>{authority === 'verified-candidate' ? hostStatus.state : 'LOCAL QA'}</span>
          </div>
          <div className={styles.crosshair} aria-hidden="true" />
          {interaction ? <button className={styles.campaignPrompt} type="button" disabled={!interaction.enabled} onClick={triggerInteraction}><kbd>E</kbd>{interactionPrompt}</button> : null}
          {snapshot.player.hidingSpotId ? (
            <div className={styles.campaignHideVignette} data-state={snapshot.player.stealthState} aria-hidden="true">
              <span>{snapshot.player.stealthState === 'hidden' ? '숨을 죽이고 있다' : '은신 중'}</span>
            </div>
          ) : null}
          <p className={styles.campaignControlsHint}>WASD 이동 · Shift 달리기 · E 상호작용 · F 손전등 · Q 집중 청취 · C 웅크리기 · Tab 인벤토리</p>
        </section>
      ) : null}

      {touchHud && started && entryPhase === 'playing' && !hideHud && !paused && !inventoryOpen ? (
        <section className={styles.campaignMobileControls} aria-label="터치 게임 조작">
          <div className={styles.campaignDpad}>
            <button type="button" onPointerDown={() => setTouchMove({ x: 0, y: 1 })} onPointerUp={clearTouchMove} onPointerCancel={clearTouchMove}>↑</button>
            <button type="button" onPointerDown={() => setTouchMove({ x: -1, y: 0 })} onPointerUp={clearTouchMove} onPointerCancel={clearTouchMove}>←</button>
            <button type="button" onPointerDown={() => setTouchMove({ x: 1, y: 0 })} onPointerUp={clearTouchMove} onPointerCancel={clearTouchMove}>→</button>
            <button type="button" onPointerDown={() => setTouchMove({ x: 0, y: -1 })} onPointerUp={clearTouchMove} onPointerCancel={clearTouchMove}>↓</button>
          </div>
          <div className={styles.campaignLookPad} onPointerDown={beginTouchLook} onPointerMove={moveTouchLook} onPointerUp={() => { lookPointerRef.current = null; }} onPointerCancel={() => { lookPointerRef.current = null; }}><span>드래그하여 보기</span></div>
          <div className={styles.campaignTouchActions}>
            <button type="button" onClick={triggerInteraction}>E</button>
            <button type="button" onClick={() => setFlashlightOn((value) => !value)}>F</button>
            <button type="button" onPointerDown={() => setListening(true)} onPointerUp={() => setListening(false)} onPointerCancel={() => setListening(false)}>Q</button>
            <button type="button" onClick={() => setCrouching((value) => !value)}>C</button>
            <button type="button" onPointerDown={() => setTouchRun(true)} onPointerUp={() => setTouchRun(false)} onPointerCancel={() => setTouchRun(false)}>Shift</button>
            <button type="button" onClick={() => setInventoryOpen(true)}>Tab</button>
          </div>
        </section>
      ) : null}

      {touchHud && started && entryPhase === 'playing' && hideHud && snapshot.rooftopPhase === 'approach' && !paused && !contextLost && !inventoryOpen ? (
        <section className={styles.cinematicTouchControls} aria-label="옥상 접근 조작">
          <p>{interaction?.id === 'ch2.namra' ? '모닥불 앞의 남라에게 다가왔습니다.' : '달리지 말고 모닥불 쪽으로 걸어가세요.'}</p>
          <button
            type="button"
            className={styles.cinematicWalkButton}
            onPointerDown={() => setTouchMove({ x: 0, y: 1 })}
            onPointerUp={clearTouchMove}
            onPointerCancel={clearTouchMove}
            onPointerLeave={clearTouchMove}
          >
            앞으로 걷기
          </button>
          <div className={styles.cinematicLookPad} onPointerDown={beginTouchLook} onPointerMove={moveTouchLook} onPointerUp={() => { lookPointerRef.current = null; }} onPointerCancel={() => { lookPointerRef.current = null; }}><span>드래그하여 보기</span></div>
          <button type="button" className={styles.cinematicInteractButton} disabled={interaction?.id !== 'ch2.namra' || !interaction.enabled} onClick={triggerInteraction}><kbd>E</kbd>{interaction?.id === 'ch2.namra' ? interaction.prompt : '남라에게 다가가기'}</button>
        </section>
      ) : null}

      {!hideHud && toastItem ? (
        <aside className={styles.pickupToast} aria-live="polite">
          <Image src={toastItem.thumbnailPath} alt="" width={62} height={62} />
          <div><span>보급품 발견</span><strong>{toastItem.name}</strong></div>
        </aside>
      ) : null}

      {!hideHud && foreshadowingCue ? (
        <aside className={styles.campaignForeshadowing} aria-live="polite">{LAST_BELL_FORESHADOWING_CUES[foreshadowingCue].copy}</aside>
      ) : null}

      <LastBellInventoryPanel
        open={inventoryOpen && (!hideHud || snapshot.gameComplete)}
        authority={authority}
        isAuthenticated={isAuthenticated}
        collected={snapshot.collectedThisRun}
        pending={snapshot.pendingCollectibles}
        committed={committed}
        onClose={() => {
          setInventoryOpen(false);
          setPaused(false);
        }}
      />

      <RooftopEndingOverlay
        phase={snapshot.rooftopPhase}
        phaseElapsedSeconds={snapshot.rooftopPhaseElapsedSeconds}
        suspended={paused || contextLost || inventoryOpen || !started}
        gameComplete={snapshot.gameComplete}
        authority={authority}
        isAuthenticated={isAuthenticated}
        runReady={authority === 'local-qa' || hostStatus.state === 'completed'}
        syncFailed={hostStatus.state === 'error'}
        claimHref={claimHref}
        onOpenInventory={() => setInventoryOpen(true)}
        onReplayChapter={(chapterId) => void startRun(chapterId, 'chapter-replay')}
        onRetrySync={() => { if (completionCandidate) void finalizeRun(completionCandidate); }}
      />

      {snapshot.captured ? (
        <section className={styles.statusOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-captured-title">
          <div className={styles.statusPanel}><span className={styles.serial}>CHECKPOINT</span><h2 id="last-bell-captured-title">붙잡혔다</h2><p>마지막 검증 체크포인트에서 다시 시작합니다.</p><button className={styles.primaryButton} type="button" onClick={retryFromCapture}>다시 일어나기</button></div>
        </section>
      ) : null}

      {paused || contextLost ? (
        <section className={styles.statusOverlay} role="dialog" aria-modal="true" aria-label={contextLost ? '그래픽 컨텍스트 복구 중' : '일시정지'}>
          <div className={styles.statusPanel}><span className={styles.serial}>LAST BELL</span><h2>{contextLost ? '그래픽 공간을 복구하고 있습니다' : '일시정지'}</h2><p>{contextLost ? 'WebGL context가 돌아오면 같은 상태에서 계속됩니다.' : '시뮬레이션과 카메라 입력이 함께 멈췄습니다.'}</p>{!contextLost ? <button className={styles.primaryButton} type="button" onClick={() => setPaused(false)}>계속하기</button> : null}</div>
        </section>
      ) : null}

      {replayComplete ? (
        <section className={styles.statusOverlay} role="dialog" aria-modal="true" aria-label="챕터 재수색 완료">
          <div className={styles.statusPanel}><span className={styles.serial}>CHAPTER EXIT VERIFIED</span><h2>죽은 학교 재수색 완료</h2><p>{authority === 'verified-candidate' && hostStatus.state !== 'completed' ? hostStatus.state === 'error' ? '출구 기록을 서버에 저장하지 못했습니다. 같은 기록으로 다시 시도할 수 있습니다.' : '출구 기록과 새 수집품을 서버에서 검증하고 있습니다…' : '이번 챕터에서 새로 찾은 상품이 인벤토리에 귀속되었습니다.'}</p>{authority === 'verified-candidate' && hostStatus.state === 'error' ? <button className={styles.primaryButton} type="button" onClick={() => { if (completionCandidate) void finalizeRun(completionCandidate); }}>검증 다시 시도</button> : null}{authority === 'local-qa' || hostStatus.state === 'completed' ? <div className={styles.completionActions}><button className={styles.primaryButton} type="button" onClick={() => setInventoryOpen(true)}>인벤토리 확인</button><button className={styles.ghostButton} type="button" onClick={() => void startRun('chapter-02', 'chapter-replay')}>옥상의 불빛 다시 보기</button></div> : null}</div>
        </section>
      ) : null}

      {hostStatus.state === 'error' ? <p className={styles.campaignSyncError} role="alert">검증 기록 동기화 실패: {hostStatus.message}</p> : null}
      {!authConfigured && authority === 'verified-candidate' ? <p className={styles.campaignSyncError} role="alert">인증 구성이 없어 검증 플레이를 시작할 수 없습니다.</p> : null}
    </main>
  );
}
