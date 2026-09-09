import { tusinSurvivalPack } from '@/lib/prototypes/tusin-survival/packs/tusin';

const EVOLUTION_TO_BASE_WEAPON: Readonly<Record<string, string>> = Object.fromEntries(
  tusinSurvivalPack.evolutions.map((evolution) => [
    evolution.id,
    evolution.recipe.activeId,
  ]),
);

export function baseWeaponPresentationId(weaponId: string | null): string | null {
  if (!weaponId) return null;
  return EVOLUTION_TO_BASE_WEAPON[weaponId] ?? weaponId;
}
