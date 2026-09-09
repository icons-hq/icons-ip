import { digestValue } from './digest';
import type { ContentPack } from '../packs/types';
import {
  createInteractiveRuntime,
  normalizeRecordedCommands,
} from './simulation';
import { PRNG_ALGORITHM_VERSION } from './prng';
import {
  REPLAY_SCHEMA_VERSION,
  SIMULATION_HZ,
  type RecordedCommand,
  type RecordedRun,
  type ReplayHeader,
  type ReplayOutcome,
  type ReplayStatus,
} from './types';

export type {
  BossDefinition,
  BossMilestone,
  EnemyDefinition,
  RecordedCommand,
  RecordedRun,
  ReplayOutcome,
  ReplayHeader,
  ReplayStatus,
  RunResult,
  RunState,
  UpgradeDefinition,
  VersionedPack,
  WaveDefinition,
  WeaponDefinition,
} from './types';
export { REPLAY_SCHEMA_VERSION, SIMULATION_HZ } from './types';
export { PRNG_ALGORITHM_VERSION } from './prng';
export {
  RUNTIME_HZ,
  createInteractiveRuntime,
  type BossScoreSnapshot,
  type BuildItemSnapshot,
  type ChestSnapshot,
  type EnemyRole,
  type EnemySnapshot,
  type InteractiveRuntime,
  type InteractiveRuntimeOptions,
  type LevelOfferSnapshot,
  type MoveIntent,
  type PickupSnapshot,
  type PlayerSnapshot,
  type ProjectileKind,
  type ProjectileSnapshot,
  type RuntimeDebugOptions,
  type RuntimeDebugSnapshot,
  type RuntimeEntitySnapshot,
  type RuntimeMode,
  type RuntimeScoreSnapshot,
  type RuntimeSnapshot,
  type ReplayAdvanceStatus,
  type VfxSnapshot,
} from './simulation';

export function createReplayHeader(pack: ContentPack, seed: string): ReplayHeader {
  return {
    replaySchemaVersion: REPLAY_SCHEMA_VERSION,
    engineVersion: pack.engineVersion,
    contentPackId: pack.id,
    contentVersion: pack.contentVersion,
    contentHash: digestValue(pack),
    seed,
    simulationHz: SIMULATION_HZ,
    prngAlgorithmVersion: PRNG_ALGORITHM_VERSION,
  };
}

/** Rejects stored logs whose engine, pack, seed, rate, or PRNG identity drifted. */
export function validateReplayHeader(
  pack: ContentPack,
  seed: string,
  header: unknown,
): header is ReplayHeader {
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return false;
  const expected = createReplayHeader(pack, seed);
  const keys = Object.keys(expected) as Array<keyof ReplayHeader>;
  const candidate = header as Record<string, unknown>;
  return Object.keys(candidate).length === keys.length && keys.every((key) => (
    expected[key] === candidate[key]
  ));
}

function isRecordedRun(
  recording: readonly RecordedCommand[] | RecordedRun,
): recording is RecordedRun {
  return !Array.isArray(recording);
}

/**
 * Replays quantized player commands through the versioned 60Hz simulation.
 * Rendering and wall-clock state are deliberately outside this pure seam.
 */
export function runRecordedCommands(
  pack: ContentPack,
  seed: string,
  recording: readonly RecordedCommand[] | RecordedRun,
): ReplayOutcome {
  let commands: readonly RecordedCommand[];
  let requestedBoundary: number | null = null;
  if (isRecordedRun(recording)) {
    commands = recording.commands;
    requestedBoundary = recording.recordedThroughTick;
  } else {
    commands = recording;
  }
  const normalized = normalizeRecordedCommands(commands);
  const legacyBoundary = Math.max(
    Number.isSafeInteger(pack.maxTicks) && pack.maxTicks >= 0 ? pack.maxTicks : 0,
    (normalized.at(-1)?.tick ?? -1) + 1,
  );
  const recordedThroughTick = requestedBoundary !== null
    && Number.isSafeInteger(requestedBoundary)
    && requestedBoundary >= 0
    ? requestedBoundary
    : legacyBoundary;
  const runtime = createInteractiveRuntime(pack, seed, { recordCommands: false });
  runtime.start();
  let cursor = 0;
  let status: ReplayStatus = 'INCOMPLETE';

  while (true) {
    const tick = runtime.getSnapshot().tick;
    while (cursor < normalized.length && normalized[cursor]!.tick < tick) {
      cursor += 1;
    }
    const commandsAtCurrentTick: RecordedCommand[] = [];
    while (cursor < normalized.length && normalized[cursor]!.tick === tick) {
      commandsAtCurrentTick.push(normalized[cursor]!);
      cursor += 1;
    }
    const advanceStatus = runtime.advanceReplay(
      commandsAtCurrentTick,
      tick < recordedThroughTick,
    );
    if (advanceStatus === 'ADVANCED') continue;
    status = advanceStatus;
    break;
  }

  const result = runtime.getRunResult();
  const header = createReplayHeader(pack, seed);

  return {
    header,
    status,
    result,
    stateDigest: digestValue({
      header,
      status,
      recordedThroughTick,
      commands: normalized,
      result,
      internal: runtime.getDeterministicState(),
    }),
  };
}
