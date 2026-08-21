import {
  createInteractiveRuntime,
  type InteractiveRuntime,
} from '@/lib/prototypes/tusin-survival/engine';
import { tusinSurvivalPack } from '@/lib/prototypes/tusin-survival/packs/tusin';

export {
  RUNTIME_HZ,
  type BossScoreSnapshot,
  type BuildItemSnapshot,
  type ChestSnapshot,
  type EnemyRole,
  type EnemySnapshot,
  type InteractiveRuntime,
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
  type VfxSnapshot,
} from '@/lib/prototypes/tusin-survival/engine';

/** IP-specific composition root; the engine itself only receives ContentPack data. */
export function createRuntime(seed: number | string): InteractiveRuntime {
  return createInteractiveRuntime(tusinSurvivalPack, seed);
}
