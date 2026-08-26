import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_CAMPAIGN_NAMRA_ASSET,
  LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET,
  LAST_BELL_CAMPAIGN_REQUIRED_ANIMATIONS,
  LAST_BELL_CAMPAIGN_ROUTE_ASSETS,
  LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS,
  LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS,
} from './campaignAssets';
import { LAST_BELL_AUTHORED_COLLIDERS } from '@/lib/prototypes/last-bell/runtime/world';

const source = readFileSync(new URL('./TwoChapterWorldScene.tsx', import.meta.url), 'utf8');
const sharedRigZombieSource = source.slice(
  source.indexOf('function SharedRigZombie'),
  source.indexOf('function PositionalZombieAudio'),
);
const sharedKtx2Loader = readFileSync(new URL('../lastBellKtx2Loader.ts', import.meta.url), 'utf8');
const root = resolve(process.cwd());

function glbJson(publicPath: string) {
  const bytes = readFileSync(resolve(root, 'public', publicPath.slice(1)));
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim()) as {
    extensionsUsed?: string[];
    nodes?: Array<{ name?: string }>;
    animations?: Array<{ name?: string }>;
  };
}

describe('two chapter world scene contract', () => {
  it('takes a simulation snapshot only and leaves action authority outside the renderer', () => {
    expect(source).toContain('snapshot: LastBellSimulationSnapshot;');
    expect(source).toContain('reducedMotion: boolean;');
    expect(source).toContain('onEnvironmentMounted?: () => void;');
    expect(source).toContain('simulation/host-owned');
    expect(source).not.toContain('queueInteraction(');
  });

  it('ships independently decodable Meshopt route and character delivery assets', () => {
    for (const [zone, path] of Object.entries(LAST_BELL_CAMPAIGN_ROUTE_ASSETS)) {
      expect(existsSync(resolve(root, 'public', path.slice(1))), path).toBe(true);
      const gltf = glbJson(path);
      const names = new Set(gltf.nodes?.map((node) => node.name));
      expect(names, zone).toContain('LOD0_Route');
      expect([...names].some((name) => name?.startsWith('Anchor_')), zone).toBe(true);
      expect(gltf.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(gltf.extensionsUsed).toContain('KHR_texture_basisu');
      expect(LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS[zone as keyof typeof LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS]).toEqual([0, 0, 0]);
    }
    for (const path of [...Object.values(LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS), LAST_BELL_CAMPAIGN_NAMRA_ASSET]) {
      expect(existsSync(resolve(root, 'public', path.slice(1))), path).toBe(true);
      const gltf = glbJson(path);
      const names = new Set(gltf.nodes?.map((node) => node.name));
      expect(names).toContain('Character_Root');
      expect(names).toContain('Armature_Common');
      expect(gltf.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(gltf.extensionsUsed).toContain('KHR_texture_basisu');
    }
    expect(source).toContain('.setKTX2Loader(getLastBellKtx2Loader(renderer))');
    expect(sharedKtx2Loader).toContain('new KTX2Loader()');
    expect(sharedKtx2Loader).toContain('LAST_BELL_ASSETS.environment3d.basisTranscoder');
  });

  it('keeps authoritative colliders on zone-local delivery assets, never the monolithic source', () => {
    const sourceAssets = LAST_BELL_AUTHORED_COLLIDERS.map((collider) => collider.sourceAsset);
    expect(sourceAssets).not.toContain('two-chapter-route.glb');
    expect(LAST_BELL_AUTHORED_COLLIDERS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'floor.corridor', sourceAsset: 'routes/corridor.glb', sourceNode: 'COL_Corridor_Lane' }),
      expect.objectContaining({ id: 'floor.stairwell', sourceAsset: 'routes/stairwell.glb', sourceNode: 'COL_Stairwell' }),
      expect.objectContaining({ id: 'floor.rooftop', sourceAsset: 'routes/rooftop.glb', sourceNode: 'COL_Rooftop' }),
    ]));
  });

  it('fails closed for missing production route assets instead of rendering an invisible proxy corridor', () => {
    expect(source).not.toContain('CampaignRouteFallback');
    expect(source).not.toContain('lastBellCampaignFallbackSurface');
    expect(source).toContain('criticalAssetFailure: failedAssetKeys.length > 0');
    expect(source).toContain('if (route.asset) return <StreamedCampaignRoute');
  });

  it('validates emitted world-space bounds, portals, and hinge-door closed poses from the GLBs', () => {
    const reportDirectory = mkdtempSync(join(tmpdir(), 'last-bell-route-validator-'));
    const reportPath = join(reportDirectory, 'report.json');
    try {
      execFileSync(process.execPath, [
        resolve(root, 'scripts/last-bell-route-assets/validate.mjs'),
        resolve(root, 'public/generated/last-bell/3d'),
        reportPath,
      ], { stdio: 'pipe' });
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      expect(report.validation).toBe('pass');
      expect(report.world_contract.routes.corridor.bounds).toEqual({ min: [-3, 24], max: [3, 67] });
      expect(report.world_contract.routes.stairwell.portals).toEqual({
        Portal_Fire: [0, .2, 67],
        Portal_Rooftop: [0, .2, 82],
      });
      expect(report.world_contract.routes.stairwell.doors).toEqual({
        'door.fire': { pivot: [-1.65, 1.5, 67], closed: [0, 1.5, 67] },
        'door.rooftop': { pivot: [-1.65, 1.5, 82], closed: [0, 1.5, 82] },
      });
      expect(report.world_contract.routes.corridor.clearances).toEqual({
        'portal.infirmary': { min: [2.48, .2, 30.1], max: [4.52, 2.65, 34], mesh_blockers: 0 },
        'portal.broadcast': { min: [-4.52, .2, 37.9], max: [-2.48, 2.65, 47.4], mesh_blockers: 0 },
      });
      expect(report.world_contract.routes.infirmary.clearances['portal.infirmary'].mesh_blockers).toBe(0);
      expect(report.world_contract.routes.broadcast.clearances['portal.broadcast'].mesh_blockers).toBe(0);
      expect(report.world_contract.routes.rooftop.bounds.max).toEqual([10.001, 108]);
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });

  it('keeps the authored animation and live-zombie ceiling at renderer boundary', () => {
    for (const animation of LAST_BELL_CAMPAIGN_REQUIRED_ANIMATIONS.zombie) {
      for (const path of Object.values(LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS)) {
        expect(glbJson(path).animations?.map((clip) => clip.name)).toContain(animation);
      }
    }
    for (const animation of LAST_BELL_CAMPAIGN_REQUIRED_ANIMATIONS.namra) {
      expect(glbJson(LAST_BELL_CAMPAIGN_NAMRA_ASSET).animations?.map((clip) => clip.name)).toContain(animation);
    }
    expect(source).toContain('snapshot.zombies.slice(0, LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.maxLiveZombies)');
    expect(LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.maxLiveZombies).toBe(2);
  });

  it('prefers the authored zombie rig and positional source over a production capsule fallback', () => {
    expect(source).toContain('PositionalZombieAudio');
    expect(source).toContain('new THREE.PositionalAudio');
    expect(source).toContain('scene.add(sound)');
    expect(source).toContain('scene.remove(sound)');
    expect(source).toContain('sound.updateMatrixWorld()');
    expect(source).not.toContain('enemy.${zombie.id}.fallback');
    expect(source).not.toContain('DegradedZombie');
    expect(source).toContain('zombieAudioOcclusion');
    expect(source).toContain("filter.type = 'lowpass'");
    expect(source).toContain('filter((actor) => zombieByVariant[actor.variant].asset)');
    expect(source).toContain('position={[0, CHARACTER_GROUND_OFFSET_Y, 0]}');
    expect(source).toContain('object.frustumCulled = false');
    expect(source).toContain('hadMaterialArray ? clonedMaterials : clonedMaterials[0]!');
    // A private, development-only Nam-ra comparison rig may hide individual
    // review cards. The production zombie renderer itself must never conceal a
    // failed actor and pretend that the encounter rendered successfully.
    expect(sharedRigZombieSource).not.toContain('object.visible = false');
    expect(source).toContain('groupRef.current.updateMatrixWorld(true)');
    expect(source).toContain('setFromObject(groupRef.current, true)');
    // The character remains readable through a short, motivated moon/fill
    // pool; do not regress to the obsolete flat cyan material-light proxy.
    expect(source).toContain('color="#c8e6df" intensity={10.5} distance={7.2}');
    expect(source).not.toContain('RooftopCharacterFallback');
  });

  it('keeps the shipped Nam-ra seam honest while human visual review is blocked', () => {
    expect(source).toContain("semanticActor: 'character.namra.rooftop'");
    expect(source).toContain("assetContract: qaNamraHybridMode ? 'private-image-based-hybrid-review-only' : 'human-review-blocked'");
    expect(source).not.toContain("assetContract: 'approved-non-likeness'");
    expect(source).not.toContain('PENDING_APPROVED_CHARACTER_REPLACEMENT');
    expect(source).toContain('streaming.requestedNamra');
  });

  it('projects the simulation hiding state onto authored locker panel transforms', () => {
    expect(source).toContain('applyLastBellHidingSpotVisuals');
    expect(source).toContain('syncLastBellHidingSpotAnimations(hidingMixer, source.animations, playerStealth)');
    expect(source).toContain('playerStealth={snapshot.player}');
  });

  it('keeps every potentially streamable route/character file inside the pack cap', () => {
    const paths = [
      ...Object.values(LAST_BELL_CAMPAIGN_ROUTE_ASSETS),
      ...Object.values(LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS),
      LAST_BELL_CAMPAIGN_NAMRA_ASSET,
    ];
    const total = paths
      .map((path) => statSync(resolve(root, 'public', path.slice(1))).size)
      .reduce((sum, bytes) => sum + bytes, 0);
    expect(total).toBeLessThanOrEqual(LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.totalTransferHardCapBytes);
  });
});
