import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AuthoredEnvironment3d.tsx', import.meta.url), 'utf8');
const sharedKtx2Loader = readFileSync(new URL('./lastBellKtx2Loader.ts', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../LastBellRuntime.tsx', import.meta.url), 'utf8');

describe('authored environment loader contract', () => {
  it('uses GLTF, Meshopt, and a local KTX2 transcoder instead of a CDN', () => {
    expect(source).toContain("from 'three/addons/loaders/GLTFLoader.js'");
    expect(source).toContain('getLastBellKtx2Loader(gl)');
    expect(sharedKtx2Loader).toContain('new KTX2Loader()');
    expect(sharedKtx2Loader).toContain('.setTranscoderPath(LAST_BELL_ASSETS.environment3d.basisTranscoder)');
    expect(source).toContain('.setMeshoptDecoder(MeshoptDecoder)');
    expect(source).toContain('.setKTX2Loader(ktx2Loader)');
    expect(source).toContain("path.startsWith('http:')");
    expect(source).toContain("path.startsWith('https:')");
    expect(source).toContain("relativePath.startsWith('lightmaps/')");
    expect(source).toContain("replace(/lightmaps\\/$/, '')");
  });

  it('waits for decoded-and-mounted GLBs before announcing readiness and fail-closes a critical load error', () => {
    expect(source).toContain('gltfLoader.loadAsync(runtimeAssetPath(assetId))');
    expect(source).toContain("const firstBay = await prepareScene('firstBay', metadata);");
    expect(source).toContain('CORE_ENVIRONMENT_ASSET_IDS.map');
    expect(source).toContain('useLayoutEffect(() => {\n    onMounted();');
    expect(source).toContain('if (failed) return null;');
    expect(source).toContain("failedAssetKeys: ['opening:environment'], criticalAssetFailure: true");
    expect(source).toContain('retryNonce = 0');
    expect(source).not.toContain('MountedFallback');
    expect(source).not.toContain('fallback');
    expect(runtime).not.toContain('props.onSceneReady?.();');
    expect(runtime).toContain('onEnvironmentMounted={onSceneReady ?? NOOP_SCENE_READY}');
  });

  it('keeps the DoorSystem snapshot as the only slider-motion input', () => {
    expect(source).toContain('classroomDoorPanelLocalX(snapshot.openProgress)');
    expect(source).toContain('bindAuthoredDoor(nextScenes.classroomDoor)');
    expect(source).toContain('Invalid classroom-door.glb semantics');
    expect(source).not.toContain('setInterval');
  });

  it('culls rooms at the authored classroom portal without replacing physical traversal', () => {
    expect(source).toContain('const doorOpen = (classroomDoorRef.current?.openProgress ?? 0) > .025;');
    expect(source).toContain('const startRoomVisible = !exteriorEntry && playerZ < 13.55;');
    expect(source).toContain('const firstBayVisible = !exteriorEntry && (doorOpen || playerZ > 12.6);');
    expect(source).toContain('portalVisibility: { startRoom: startRoomVisible, firstBay: firstBayVisible }');
    expect(runtime).toContain('playerPositionRef={positionRef}');
  });

  it('publishes authored/error identity, decoded bounds, and active tier for browser QA', () => {
    expect(source).toContain('__ICONS_LAST_BELL_QA__');
    expect(source).toContain("assetMode: 'authored'");
    expect(source).toContain("assetMode: 'error'");
    expect(source).toContain('decodedBounds(nextScenes[id])');
    expect(source).toContain('tier: quality.id');
    expect(runtime).toContain('gl.info.render.calls');
    expect(runtime).toContain('gl.info.render.triangles');
    expect(runtime).toContain('qaFramesRef.current / qaElapsedRef.current');
  });

  it('clones materials, binds glTF TEXCOORD_1, and does not treat AO as emitted light', () => {
    expect(source).toContain('cloneMaterialForRuntime');
    expect(source).toContain('const textureChannel = 1;');
    expect(source).toContain('object.geometry.getAttribute(binding.uv)');
    expect(source).toContain('lightmapMaterial.lightMap = runtimeTexture;');
    expect(source).toContain("binding.kind === 'cycles-ground-receiver-ao'");
    expect(source).toContain('lightmapMaterial.aoMap = runtimeTexture;');
    expect(source).toContain('THREE.NoColorSpace');
  });
});
