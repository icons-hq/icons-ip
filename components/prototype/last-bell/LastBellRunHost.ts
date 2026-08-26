'use client';

import type {
  ChapterId,
  CollectibleKey,
  LastBellRuntimeEvent,
  LastBellSimulationSnapshot,
} from '@/lib/prototypes/last-bell/runtime/types';
import { LAST_BELL_COLLECTIBLE_KEYS } from '@/lib/prototypes/last-bell/runtime/types';

export type LastBellRunAuthority = 'local-qa' | 'verified-candidate';
export type LastBellRunSyncState = 'idle' | 'starting' | 'active' | 'syncing' | 'completed' | 'error';

export type LastBellRunHostStatus = Readonly<{
  state: LastBellRunSyncState;
  runId: string | null;
  message: string | null;
}>;

export type LastBellRunStart = Readonly<{
  runId: string;
  startChapterId: ChapterId;
  runMode: 'first-play' | 'chapter-replay';
  resumed: boolean;
  progressStage: number;
  pickedCollectibles: readonly CollectibleKey[];
}>;

/** The UI must resolve a persisted terminal run before mounting a live simulation. */
export type LastBellRunResumeResolution = Readonly<{
  restoredChapter: ChapterId;
  terminal: 'game-complete' | 'chapter-exit' | null;
}>;

export function resolveLastBellRunResume(result: LastBellRunStart): LastBellRunResumeResolution {
  const restoredChapter: ChapterId = result.runMode === 'chapter-replay'
    ? result.startChapterId
    : result.progressStage >= 6 ? 'chapter-02' : result.startChapterId;
  if (result.progressStage >= 11) return { restoredChapter, terminal: 'game-complete' };
  if (result.runMode === 'chapter-replay' && result.startChapterId === 'chapter-01' && result.progressStage >= 6) {
    return { restoredChapter, terminal: 'chapter-exit' };
  }
  return { restoredChapter, terminal: null };
}

type VerifiedEventPayload = Readonly<{
  sequence: number;
  operationId: string;
  type: LastBellRuntimeEvent['type'];
  chapterId: ChapterId;
  zoneId: LastBellSimulationSnapshot['zoneId'];
  objectiveId: string | null;
  collectibleKey: CollectibleKey | null;
  checkpointId: string | null;
}>;

export interface LastBellRunHost {
  readonly authority: LastBellRunAuthority;
  start(chapterId: ChapterId, runMode: 'first-play' | 'chapter-replay'): Promise<LastBellRunStart>;
  record(event: LastBellRuntimeEvent, snapshot: LastBellSimulationSnapshot): void;
  complete(): Promise<void>;
  claim(runId: string): Promise<void>;
  loadInventory(): Promise<readonly CollectibleKey[]>;
  status(): LastBellRunHostStatus;
}

const VERIFIED_OBJECTIVES = new Set([
  'ch1.open-classroom-door',
  'ch1.restore-emergency-power',
  'ch1.ring-last-bell',
  'ch2.search-stairwell',
  'ch2.approach-namra',
]);
const VERIFIED_COLLECTIBLE_KEYS = new Set<string>(LAST_BELL_COLLECTIBLE_KEYS);

function shouldSync(event: LastBellRuntimeEvent): boolean {
  // Renderer/UI-only infection cues deliberately stay local. They are not
  // persisted run milestones and must never reach the verified-run API.
  if (event.type === 'foreshadowing') return false;
  return event.type !== 'objective' || VERIFIED_OBJECTIVES.has(event.objectiveId);
}

function assertOk(response: Response): Promise<unknown> {
  if (response.ok) return response.json() as Promise<unknown>;
  return response.json().catch(() => null).then((body) => {
    const code = typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : null;
    throw new Error(typeof code === 'string' ? code : `http_${response.status}`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class LocalRunHost implements LastBellRunHost {
  readonly authority = 'local-qa' as const;
  private current: LastBellRunHostStatus = { state: 'idle', runId: null, message: null };

  async start(chapterId: ChapterId, runMode: 'first-play' | 'chapter-replay'): Promise<LastBellRunStart> {
    const runId = `local-${crypto.randomUUID()}`;
    this.current = { state: 'active', runId, message: null };
    return {
      runId,
      startChapterId: chapterId,
      runMode,
      resumed: false,
      progressStage: chapterId === 'chapter-02' ? 6 : 0,
      pickedCollectibles: [],
    };
  }

  record(): void {}

  async complete(): Promise<void> {
    this.current = { ...this.current, state: 'completed' };
  }

  async claim(): Promise<void> {}

  async loadInventory(): Promise<readonly CollectibleKey[]> { return []; }

  status(): LastBellRunHostStatus { return this.current; }
}

export class VerifiedRunHost implements LastBellRunHost {
  readonly authority = 'verified-candidate' as const;
  private current: LastBellRunHostStatus = { state: 'idle', runId: null, message: null };
  private sequence = 0;
  private outbox: VerifiedEventPayload[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly onStatus: (status: LastBellRunHostStatus) => void = () => undefined) {}

  private publish(next: LastBellRunHostStatus): void {
    this.current = next;
    this.onStatus(next);
  }

  async start(chapterId: ChapterId, runMode: 'first-play' | 'chapter-replay'): Promise<LastBellRunStart> {
    this.publish({ state: 'starting', runId: null, message: null });
    try {
      const body = await assertOk(await fetch('/api/experiences/last-bell/runs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startChapterId: chapterId, runMode }),
      }));
      if (
        !isRecord(body)
        || typeof body.runId !== 'string'
        || (body.startChapterId !== 'chapter-01' && body.startChapterId !== 'chapter-02')
        || (body.runMode !== 'first-play' && body.runMode !== 'chapter-replay')
        || typeof body.resumed !== 'boolean'
        || typeof body.progressStage !== 'number'
        || !Number.isSafeInteger(body.progressStage)
        || body.progressStage < 0
        || body.progressStage > 11
      ) throw new Error('invalid_start_response');
      this.sequence = typeof body.lastSequence === 'number' ? body.lastSequence : 0;
      this.outbox = [];
      this.flushPromise = null;
      const pickedCollectibles = Array.isArray(body.pickedCollectibleKeys)
        ? body.pickedCollectibleKeys.filter((key): key is CollectibleKey => (
          typeof key === 'string' && VERIFIED_COLLECTIBLE_KEYS.has(key)
        ))
        : [];
      this.publish({ state: 'active', runId: body.runId, message: null });
      return {
        runId: body.runId,
        startChapterId: body.startChapterId,
        runMode: body.runMode,
        resumed: body.resumed,
        progressStage: body.progressStage,
        pickedCollectibles,
      };
    } catch (error) {
      this.publish({ state: 'error', runId: null, message: error instanceof Error ? error.message : 'start_failed' });
      throw error;
    }
  }

  record(event: LastBellRuntimeEvent, snapshot: LastBellSimulationSnapshot): void {
    if (!shouldSync(event) || !this.current.runId) return;
    const runId = this.current.runId;
    const sequence = ++this.sequence;
    const payload: VerifiedEventPayload = {
      sequence,
      operationId: crypto.randomUUID(),
      type: event.type,
      chapterId: event.type === 'game_complete' ? 'chapter-02' : event.chapterId,
      zoneId: event.type === 'game_complete'
        ? 'rooftop'
        : event.type === 'objective' ? event.zoneId ?? snapshot.zoneId : snapshot.zoneId,
      objectiveId: event.type === 'objective' ? event.objectiveId : null,
      collectibleKey: event.type === 'pickup' ? event.collectibleKey : null,
      checkpointId: event.type === 'checkpoint' ? event.checkpointId : null,
    };
    this.outbox.push(payload);
    // Preserve sequence order after a failed head event. Later renderer events
    // may queue, but they must not implicitly retry or leap over that head;
    // an explicit completion/retry is the only recovery boundary.
    if (this.current.state === 'error') return;
    this.publish({ state: 'syncing', runId, message: null });
    void this.flushOutbox().catch(() => undefined);
  }

  private flushOutbox(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const runId = this.current.runId;
    if (!runId) return Promise.reject(new Error('run_not_started'));
    const flush = async () => {
      while (this.outbox.length > 0) {
        const payload = this.outbox[0]!;
        try {
          await assertOk(await fetch(`/api/experiences/last-bell/runs/${runId}/events`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }));
          this.outbox.shift();
        } catch (error) {
          const failure = error instanceof Error ? error : new Error('event_sync_failed');
          this.publish({ state: 'error', runId, message: failure.message });
          throw failure;
        }
      }
      this.publish({ state: 'active', runId, message: null });
    };
    this.flushPromise = flush().finally(() => {
      this.flushPromise = null;
      if (this.outbox.length > 0 && this.current.state !== 'error') {
        void this.flushOutbox().catch(() => undefined);
      }
    });
    return this.flushPromise;
  }

  async complete(): Promise<void> {
    const runId = this.current.runId;
    if (!runId) throw new Error('run_not_started');
    this.publish({ state: 'syncing', runId, message: null });
    try {
      await this.flushOutbox();
      await assertOk(await fetch(`/api/experiences/last-bell/runs/${runId}/complete`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }));
      this.publish({ state: 'completed', runId, message: null });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('complete_failed');
      this.publish({ state: 'error', runId, message: failure.message });
      throw failure;
    }
  }

  async claim(runId: string): Promise<void> {
    await assertOk(await fetch(`/api/experiences/last-bell/runs/${runId}/claim`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
  }

  async loadInventory(): Promise<readonly CollectibleKey[]> {
    const body = await assertOk(await fetch('/api/me/last-bell-inventory', { credentials: 'same-origin' }));
    if (!isRecord(body) || !Array.isArray(body.items)) return [];
    return body.items.flatMap((item) => (
      isRecord(item) && typeof item.collectibleKey === 'string' ? [item.collectibleKey as CollectibleKey] : []
    ));
  }

  status(): LastBellRunHostStatus { return this.current; }
}
