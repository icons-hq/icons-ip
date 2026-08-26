import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAPTER_01_PLAYER_START } from '@/lib/prototypes/last-bell/content/chapter-01';
import { HYOSAN_POST_STRIKE_NIGHT } from '@/lib/prototypes/last-bell/environment-profile';
import { POST_STRIKE_RENDER_GUARDRAILS } from './postStrikeLookdev';

const chapterScene = readFileSync(new URL('./ChapterOneScene.tsx', import.meta.url), 'utf8');
const door = readFileSync(new URL('./SchoolDoor.tsx', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../LastBellRuntime.tsx', import.meta.url), 'utf8');
const startRoom = readFileSync(new URL('./StartRoom.tsx', import.meta.url), 'utf8');
const visualSpec = readFileSync(new URL('../../../../docs/ip/all-of-us-are-dead-2/visual-spec.md', import.meta.url), 'utf8');

describe('post-strike first-review scene contract', () => {
  it('records display-sRGB brightness references and preserves a local-light budget', () => {
    const { luminance, lighting } = POST_STRIKE_RENDER_GUARDRAILS;
    expect(luminance).toMatchObject({
      colorSpace: 'display-srgb',
      meanUnit: '8-bit luma (0-255)',
      below16Threshold: 16,
      referenceBands: {
        entry: { mean: { reference: 8.2 }, below16Percent: { reference: 85.1 } },
        classroom: { mean: { reference: 10.99 }, below16Percent: { reference: 78.49 } },
        corridor: { mean: { reference: 6.79 }, below16Percent: { reference: 89.12 } },
        flashlight: { mean: { reference: 4.25 }, below16Percent: { reference: 90.93 } },
      },
    });
    for (const band of Object.values(luminance.referenceBands)) {
      expect(band.mean.min).toBeLessThan(band.mean.reference);
      expect(band.mean.max).toBeGreaterThan(band.mean.reference);
      expect(band.below16Percent.min).toBeLessThan(band.below16Percent.reference);
      expect(band.below16Percent.max).toBeGreaterThan(band.below16Percent.reference);
    }
    expect(lighting.exposure).toEqual({ base: .78, playing: .78, coldOpen: .9 });
    expect(HYOSAN_POST_STRIKE_NIGHT.lighting.exposure).toBe(lighting.exposure.base);
    expect(lighting.interior).toMatchObject({
      directionalCyan: .18,
      windowPool: 2.75,
      floorPool: .9,
      coldOpenDirectionalCyan: .34,
      coldOpenRearPool: 3.6,
    });
    expect(lighting.interior).not.toHaveProperty('ambient');
    expect(lighting.interior).not.toHaveProperty('hemisphere');
    expect(chapterScene).toContain('function CorridorWindowLightRig');
    expect(chapterScene).toContain('const visible = doorOpen || playerZ > 12.6;');
    expect(chapterScene).toContain('position={[-2.55, 2.35, 17.1]}');
    expect(lighting.exterior).toMatchObject({ directionalCyan: .38, facadePool: 7.5, facadeRim: 2.2 });
    expect(lighting.exterior).not.toHaveProperty('ambient');
    expect(lighting.exterior).not.toHaveProperty('hemisphere');
  });

  it('keeps camera and near-geometry bounds inside the readable frame budget', () => {
    const { camera, composition } = POST_STRIKE_RENDER_GUARDRAILS;
    const [entryX, entryY, entryZ] = camera.entry.position;
    const [facadeX, facadeY, facadeZ] = composition.facade.position;
    const [coldX, coldY, coldZ] = camera.coldOpen.position;
    const [occluderX, occluderY, occluderZ] = composition.foregroundOccluder.position;

    expect(camera.projection.fov).toBeLessThanOrEqual(68);
    expect(Math.hypot(entryX - facadeX, entryY - facadeY, entryZ - facadeZ)).toBeLessThan(8.5);
    expect(coldX).toBeGreaterThanOrEqual(2);
    expect(coldX).toBeLessThanOrEqual(3);
    expect(coldY).toBeGreaterThanOrEqual(1.35);
    expect(coldY).toBeLessThanOrEqual(1.55);
    expect(coldZ).toBeGreaterThanOrEqual(9);
    expect(coldZ).toBeLessThanOrEqual(10.5);
    expect(camera.coldOpen.yaw).toBeGreaterThanOrEqual(0);
    expect(camera.coldOpen.yaw).toBeLessThanOrEqual(.15);
    expect(coldZ).toBeGreaterThan(CHAPTER_01_PLAYER_START.z + 5);
    expect(Math.hypot(coldX - occluderX, coldY - occluderY, coldZ - occluderZ)).toBeGreaterThan(2.5);
    expect(Math.max(...composition.foregroundOccluder.scale)).toBeLessThanOrEqual(.45);
    expect(composition.foregroundOccluderMaxViewport).toBeLessThanOrEqual(.2);
    expect(composition.ceilingForegroundMaxViewport).toBeLessThanOrEqual(.2);
    expect(coldZ - composition.nearestCeilingPanelZ).toBeGreaterThan(2.5);
    expect(composition.classroomSubjectMinViewport).toBeGreaterThanOrEqual(.7);
  });

  it('uses the rear classroom as the cinematic subject, then preserves player-start for the door-facing handoff', () => {
    const { composition } = POST_STRIKE_RENDER_GUARDRAILS;
    expect(composition.coldOpenDeskPositions).toHaveLength(2);
    expect(composition.rearBlackboard).toMatchObject({ position: [0, 2.78, -1.67], width: 7.85, height: 1.58 });
    expect(composition.rearBrickPatches).toHaveLength(2);
    expect(composition.leftWindowHeroBay).toMatchObject({ position: [-6.77, 2.32, 1.25], maxViewport: .25 });
    expect(POST_STRIKE_RENDER_GUARDRAILS.palette.structuralDark).toBe('#24383b');
    expect(POST_STRIKE_RENDER_GUARDRAILS.palette.structuralMid).toBe('#43575a');
    expect(runtime).toContain('CHAPTER_01_PLAYER_START');
    expect(runtime).not.toContain('z: 9');
  });

  it('does not reintroduce freestanding cyan or blackboard hero planes into the classroom', () => {
    expect(startRoom).toContain('WINDOW_BAYS');
    expect(startRoom).not.toContain('function ColdOpenBlackboard');
    expect(startRoom).not.toContain('function ColdOpenWindowCue');
    expect(startRoom).not.toContain('coldOpenBlackboard');
    expect(startRoom).not.toContain('coldOpenWindowCue');
  });

  it('keeps the actual window opening dark and its rubble instanced while leaving renderer output to browser QA', () => {
    expect(startRoom).toContain('The opening stays dark');
    expect(startRoom).toContain('color={CYAN_GLASS} emissive="#020d0f"');
    expect(startRoom).toContain('CYAN_WINDOW_EDGE');
    expect(startRoom).toContain('<instancedMesh');
    expect(startRoom).toContain('CLASSROOM_RUBBLE');
  });

  it('mounts the authored GLB environment and keeps primitives behind an explicit debug-only seam', () => {
    expect(chapterScene).toContain('AuthoredEnvironment3d');
    expect(chapterScene).toContain('export function DebugProceduralEnvironmentFallback');
    expect(chapterScene).not.toContain('fallback={<');
    expect(chapterScene).toContain('onAssetStatus={onAssetStatus}');
    expect(chapterScene).toContain('CORRIDOR_WINDOW_BAYS');
    expect(chapterScene).toContain('PostStrikeAtmosphere');
    expect(chapterScene).toContain('<points ref={ashRef}');
    expect(chapterScene).toContain('THREE.AdditiveBlending');
    expect(chapterScene).not.toContain('RouteBeacon');
    expect(chapterScene).not.toContain('FireDoor');
    expect(chapterScene).not.toContain('function Bell(');
    expect(chapterScene).not.toContain('function Enemy(');
    expect(chapterScene).not.toContain('SchoolMaterials');
    expect(runtime).not.toContain('TextureLoader');
  });

  it('keeps a damaged classroom slider wired to the existing snapshot adapter', () => {
    expect(door).toContain('snapshotRef.current');
    expect(door).toContain('snapshot.openProgress');
    expect(door).toContain('missingGlazing');
    expect(door).toContain('not an exterior hinge door');
  });

  it('records attachment-only visual truth and prohibits source-pixel shipping', () => {
    expect(visualSpec).toContain('사용자가 제공한 드라마 attachment가 design truth다.');
    expect(visualSpec).toContain('production bundle에 복사/ship하지 않는다');
    expect(visualSpec).toContain('hyosan-post-strike-night');
  });
});
