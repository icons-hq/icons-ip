import { describe, expect, it } from 'vitest';
import { LAST_BELL_ASSETS } from './assets';
import {
  LAST_BELL_3D_ASSET_PATHS,
  LAST_BELL_3D_DELIVERY_FILE_PATHS,
  LAST_BELL_DOOR_SEMANTIC_NODE_NAMES,
  classroomDoorPanelLocalX,
  lastBellQualityTierForDpr,
  normalizeLastBellLightmapBindings,
  selectLastBellLightmapBindings,
  validateLastBellDoorSemanticNodes,
} from './environment3d';

describe('last bell authored 3d environment contract', () => {
  it('keeps the complete local generated pack under one public root', () => {
    expect(LAST_BELL_ASSETS.environment3d).toEqual(LAST_BELL_3D_ASSET_PATHS);
    expect(Object.values(LAST_BELL_3D_ASSET_PATHS).every((path) => path.startsWith('/generated/last-bell/3d/'))).toBe(true);
    expect(LAST_BELL_3D_ASSET_PATHS.basisTranscoder).toContain('/basis/');
    expect(LAST_BELL_3D_ASSET_PATHS.lightmaps).toContain('/lightmaps/');
    expect(LAST_BELL_3D_DELIVERY_FILE_PATHS).toHaveLength(10);
    expect(LAST_BELL_3D_DELIVERY_FILE_PATHS.every((path) => !path.endsWith('/'))).toBe(true);
  });

  it('requires the authored classroom slider semantic nodes', () => {
    expect(validateLastBellDoorSemanticNodes(LAST_BELL_DOOR_SEMANTIC_NODE_NAMES)).toEqual({ valid: true, missing: [] });
    expect(validateLastBellDoorSemanticNodes(['Door_Frame', 'Door_Rail'])).toEqual({
      valid: false,
      missing: ['Door_Panel_L', 'Door_Panel_R', 'Door_Glass_L', 'Door_Glass_R'],
    });
  });

  it('maps only DoorSystem open progress to local outward slider travel', () => {
    expect(classroomDoorPanelLocalX(0)).toEqual({ left: -.54, right: .54 });
    expect(classroomDoorPanelLocalX(.5)).toEqual({ left: -1.06, right: 1.06 });
    expect(classroomDoorPanelLocalX(1)).toEqual({ left: -1.58, right: 1.58 });
    expect(classroomDoorPanelLocalX(Number.NaN)).toEqual({ left: -.54, right: .54 });
  });

  it('uses the capped mobile, medium, and desktop rendering tiers', () => {
    expect(lastBellQualityTierForDpr(1)).toMatchObject({ id: 'low', shadowMapSize: 512 });
    expect(lastBellQualityTierForDpr(1.25)).toMatchObject({ id: 'medium', shadowMapSize: 768 });
    expect(lastBellQualityTierForDpr(1.5)).toMatchObject({ id: 'desktop', shadowMapSize: 1024 });
    expect(lastBellQualityTierForDpr(3)).toMatchObject({ id: 'desktop', maxDpr: 1.5 });
  });

  it('normalizes metadata lightmaps and selects the active quality tier', () => {
    const bindings = normalizeLastBellLightmapBindings({
      Classroom_Wall: {
        path: 'lightmaps/classroom-medium.ktx2',
        tier: 'medium',
        kind: 'cycles-ground-receiver-ao',
        uvChannel: 2,
        intensity: .8,
      },
      Corridor_Wall: { path: 'lightmaps/corridor-desktop.ktx2', tier: 'desktop' },
    });
    expect(bindings).toEqual([
      {
        path: 'lightmaps/classroom-medium.ktx2',
        nodes: ['Classroom_Wall'],
        tier: 'medium',
        kind: 'cycles-ground-receiver-ao',
        uv: 'uv1',
        intensity: .8,
      },
      {
        path: 'lightmaps/corridor-desktop.ktx2',
        nodes: ['Corridor_Wall'],
        tier: 'desktop',
        kind: 'baked-light',
        uv: 'uv1',
        intensity: 1,
      },
    ]);
    expect(selectLastBellLightmapBindings(bindings, lastBellQualityTierForDpr(1.25))).toHaveLength(1);
    expect(selectLastBellLightmapBindings(bindings.slice(0, 1), lastBellQualityTierForDpr(1))).toHaveLength(1);
    expect(selectLastBellLightmapBindings(bindings.slice(0, 1), lastBellQualityTierForDpr(2))).toHaveLength(1);
  });
});
