'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { RefObject } from 'react';
import { LAST_BELL_ASSETS } from '@/lib/prototypes/last-bell/assets';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import type { DoorSnapshot } from '@/lib/prototypes/last-bell/engine/doors';
import type { LastBellPlayerSnapshot } from '@/lib/prototypes/last-bell/runtime/types';
import {
  classroomDoorPanelLocalX,
  normalizeLastBellLightmapBindings,
  selectLastBellLightmapBindings,
  validateLastBellDoorSemanticNodes,
  type LastBellEnvironment3dAssetId,
  type LastBellLightmapBinding,
  type LastBellQualityTier,
} from '@/lib/prototypes/last-bell/environment3d';
import { applyLastBellHidingSpotVisuals, syncLastBellHidingSpotAnimations } from './hidingSpotVisuals';
import { getLastBellKtx2Loader } from './lastBellKtx2Loader';

type AuthoredEnvironment3dProps = {
  entryPhase: EntryDirectorPhase;
  classroomDoorRef: RefObject<DoorSnapshot | null>;
  playerPositionRef: RefObject<{ x: number; z: number }>;
  playerStealth: Pick<LastBellPlayerSnapshot, 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>;
  quality: LastBellQualityTier;
  /** Called only after decoded authored assets commit. */
  onMounted: () => void;
  /** Re-runs failed local GLB/KTX2 loading without ever mounting primitives. */
  retryNonce?: number;
  onAssetStatus?: (status: LastBellOpeningAssetStatus) => void;
};

export type LastBellOpeningAssetStatus = Readonly<{
  failedAssetKeys: readonly ['opening:environment'] | readonly [];
  criticalAssetFailure: boolean;
}>;

type EnvironmentMetadata = {
  lightmaps?: unknown;
  assets?: Partial<Record<LastBellEnvironment3dAssetId, { lightmaps?: unknown }>>;
};

type CoreAuthoredSceneSet = Pick<Record<LastBellEnvironment3dAssetId, THREE.Object3D>, 'entry' | 'startRoom' | 'classroomDoor'>;
type AuthoredSceneSet = CoreAuthoredSceneSet & { firstBay?: THREE.Object3D };

type DoorBinding = {
  root: THREE.Object3D;
  panelLeft: THREE.Object3D;
  panelRight: THREE.Object3D;
  glassLeft: THREE.Object3D;
  glassRight: THREE.Object3D;
  glassLeftBaseX: number;
  glassRightBaseX: number;
  glassLeftFollowsPanel: boolean;
  glassRightFollowsPanel: boolean;
};

const CORE_ENVIRONMENT_ASSET_IDS = ['entry', 'startRoom', 'classroomDoor'] as const satisfies readonly LastBellEnvironment3dAssetId[];
const RUNTIME_TEXTURE_FIELDS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'lightMap',
  'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap', 'transmissionMap',
] as const;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function runtimeAssetPath(id: LastBellEnvironment3dAssetId): string {
  return LAST_BELL_ASSETS.environment3d[id];
}

type LastBellRuntimeQa = {
  assetMode?: 'loading' | 'authored' | 'error';
  loadedIds?: LastBellEnvironment3dAssetId[];
  decodedBounds?: Partial<Record<LastBellEnvironment3dAssetId, { min: number[]; max: number[] }>>;
  tier?: LastBellQualityTier['id'];
  portalVisibility?: { startRoom: boolean; firstBay: boolean };
};

function publishRuntimeQa(patch: LastBellRuntimeQa): void {
  const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: LastBellRuntimeQa };
  scope.__ICONS_LAST_BELL_QA__ = { ...scope.__ICONS_LAST_BELL_QA__, ...patch };
}

function decodedBounds(scene: THREE.Object3D): { min: number[]; max: number[] } {
  const bounds = new THREE.Box3().setFromObject(scene);
  return {
    min: bounds.min.toArray().map((value) => Number(value.toFixed(3))),
    max: bounds.max.toArray().map((value) => Number(value.toFixed(3))),
  };
}

function toLocalGeneratedUrl(path: string): string {
  if (path.startsWith('http:') || path.startsWith('https:') || path.startsWith('//')) {
    throw new Error(`Last Bell 3D asset must remain local: ${path}`);
  }
  const relativePath = path.replace(/^\.\//, '');
  // Metadata records delivery-relative paths (`lightmaps/foo.ktx2`), whereas
  // node extras may record only the lightmap filename. Handle both forms
  // without producing the invalid `.../lightmaps/lightmaps/...` URL.
  const normalized = path.startsWith('/')
    ? path
    : relativePath.startsWith('lightmaps/')
      ? `${LAST_BELL_ASSETS.environment3d.lightmaps.replace(/lightmaps\/$/, '')}${relativePath}`
      : `${LAST_BELL_ASSETS.environment3d.lightmaps}${relativePath}`;
  if (!normalized.startsWith('/generated/last-bell/3d/')) {
    throw new Error(`Last Bell 3D asset escapes the generated pack: ${path}`);
  }
  return normalized;
}

function cloneTextureForRuntime(texture: THREE.Texture, maxAnisotropy: number): THREE.Texture {
  const cloned = texture.clone();
  cloned.anisotropy = Math.min(maxAnisotropy, 4);
  cloned.needsUpdate = true;
  return cloned;
}

function cloneMaterialForRuntime(material: THREE.Material, maxAnisotropy: number): THREE.Material {
  const cloned = material.clone() as THREE.Material & Record<string, unknown>;
  for (const key of RUNTIME_TEXTURE_FIELDS) {
    const texture = cloned[key];
    // The decoded source GLTF is never mounted. Material instances need to be
    // local for lightmap assignment, but immutable texture/image data stays
    // shared to avoid multiplying GPU allocations across four environment GLBs.
    if (texture instanceof THREE.Texture) {
      const cappedAnisotropy = Math.min(maxAnisotropy, 4);
      if (texture.anisotropy !== cappedAnisotropy) {
        texture.anisotropy = cappedAnisotropy;
        texture.needsUpdate = true;
      }
    }
  }
  return cloned;
}

/** GLTFLoader caches the decoded source. Every mounted scene must own materials. */
function cloneSceneForRuntime(source: THREE.Object3D, maxAnisotropy: number, heroDoor: boolean): THREE.Object3D {
  const scene = cloneSkeleton(source);
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => cloneMaterialForRuntime(material, maxAnisotropy))
      : cloneMaterialForRuntime(object.material, maxAnisotropy);
    // Static baked rooms do not spend the shadow budget. The authored slider
    // remains the one moving geometry that can cast inside the flashlight cone.
    object.castShadow = heroDoor;
    object.receiveShadow = true;
  });
  return scene;
}

function metadataBindingsForAsset(metadata: EnvironmentMetadata, assetId: LastBellEnvironment3dAssetId): LastBellLightmapBinding[] {
  return [
    ...normalizeLastBellLightmapBindings(metadata.lightmaps),
    ...normalizeLastBellLightmapBindings(metadata.assets?.[assetId]?.lightmaps),
  ];
}

function extrasBindingsForScene(scene: THREE.Object3D): LastBellLightmapBinding[] {
  const bindings: LastBellLightmapBinding[] = [];
  scene.traverse((object) => {
    const extras = object.userData as Record<string, unknown>;
    const path = typeof extras.lightmap === 'string'
      ? extras.lightmap
      : typeof extras.lightmapPath === 'string'
        ? extras.lightmapPath
        : null;
    if (!path || !path.endsWith('.ktx2')) return;
    bindings.push({
      path,
      nodes: [object.name],
      tier: extras.lightmapTier === 'low' || extras.lightmapTier === 'medium' || extras.lightmapTier === 'desktop'
        ? extras.lightmapTier
        : undefined,
      kind: extras.lightmapKind === 'cycles-ground-receiver-ao'
        ? extras.lightmapKind
        : 'baked-light',
      // Three r182 maps glTF TEXCOORD_1 to `uv1`, not `uv2`.
      uv: 'uv1',
      intensity: typeof extras.lightmapIntensity === 'number' && Number.isFinite(extras.lightmapIntensity)
        ? extras.lightmapIntensity
        : 1,
    });
  });
  return bindings;
}

function materialArray(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function applyLightmapBinding(
  scene: THREE.Object3D,
  binding: LastBellLightmapBinding,
  texture: THREE.Texture,
  maxAnisotropy: number,
): void {
  const textureChannel = 1;
  const targetColorSpace = binding.kind === 'cycles-ground-receiver-ao'
    ? THREE.NoColorSpace
    : THREE.SRGBColorSpace;
  const needsClone = texture.colorSpace !== targetColorSpace || texture.channel !== textureChannel;
  const runtimeTexture = needsClone ? cloneTextureForRuntime(texture, maxAnisotropy) : texture;
  runtimeTexture.colorSpace = targetColorSpace;
  runtimeTexture.anisotropy = Math.min(maxAnisotropy, 4);
  runtimeTexture.channel = textureChannel;
  runtimeTexture.needsUpdate = true;
  for (const name of binding.nodes) {
    const target = scene.getObjectByName(name);
    if (!target) continue;
    target.traverse((object) => {
      if (!isMesh(object) || !object.geometry.getAttribute(binding.uv)) return;
      for (const material of materialArray(object.material)) {
        const lightmapMaterial = material as THREE.Material & {
          lightMap?: THREE.Texture | null;
          lightMapIntensity?: number;
          aoMap?: THREE.Texture | null;
          aoMapIntensity?: number;
          needsUpdate: boolean;
        };
        if (binding.kind === 'cycles-ground-receiver-ao') {
          if (!('aoMap' in lightmapMaterial)) continue;
          lightmapMaterial.aoMap = runtimeTexture;
          lightmapMaterial.aoMapIntensity = binding.intensity;
        } else {
          if (!('lightMap' in lightmapMaterial)) continue;
          lightmapMaterial.lightMap = runtimeTexture;
          lightmapMaterial.lightMapIntensity = binding.intensity;
        }
        lightmapMaterial.needsUpdate = true;
      }
    });
  }
}

function isDescendant(parent: THREE.Object3D, target: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = target.parent;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}

function bindAuthoredDoor(root: THREE.Object3D): DoorBinding {
  const named = new Map<string, THREE.Object3D>();
  root.traverse((object) => named.set(object.name, object));
  const validation = validateLastBellDoorSemanticNodes(named.keys());
  if (!validation.valid) throw new Error(`Invalid classroom-door.glb semantics: missing ${validation.missing.join(', ')}`);
  const panelLeft = named.get('Door_Panel_L')!;
  const panelRight = named.get('Door_Panel_R')!;
  const glassLeft = named.get('Door_Glass_L')!;
  const glassRight = named.get('Door_Glass_R')!;
  return {
    root,
    panelLeft,
    panelRight,
    glassLeft,
    glassRight,
    glassLeftBaseX: glassLeft.position.x,
    glassRightBaseX: glassRight.position.x,
    glassLeftFollowsPanel: isDescendant(panelLeft, glassLeft),
    glassRightFollowsPanel: isDescendant(panelRight, glassRight),
  };
}

/* eslint-disable react-hooks/immutability -- R3F Object3D transforms are renderer-owned frame state, sourced only from DoorSystem snapshots. */
function AuthoredDoor({ scene, snapshotRef }: { scene: THREE.Object3D; snapshotRef: RefObject<DoorSnapshot | null> }) {
  const binding = useMemo(() => bindAuthoredDoor(scene), [scene]);
  useFrame(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    const transform = snapshot.render.closedTransform;
    binding.root.position.set(transform.position.x, transform.position.y, transform.position.z);
    binding.root.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    const panels = classroomDoorPanelLocalX(snapshot.openProgress);
    binding.panelLeft.position.x = panels.left;
    binding.panelRight.position.x = panels.right;
    if (!binding.glassLeftFollowsPanel) binding.glassLeft.position.x = binding.glassLeftBaseX - snapshot.openProgress * 1.04;
    if (!binding.glassRightFollowsPanel) binding.glassRight.position.x = binding.glassRightBaseX + snapshot.openProgress * 1.04;
  });
  return <primitive object={scene} dispose={null} />;
}
/* eslint-enable react-hooks/immutability */

function MountedAuthoredEnvironment({
  scenes,
  entryPhase,
  classroomDoorRef,
  playerPositionRef,
  playerStealth,
  onMounted,
}: Omit<AuthoredEnvironment3dProps, 'quality'> & { scenes: AuthoredSceneSet }) {
  const exteriorEntry = entryPhase === 'preflight' || entryPhase === 'brand';
  const startRoomRef = useRef<THREE.Group>(null);
  const firstBayRef = useRef<THREE.Group>(null);
  const lastVisibilityRef = useRef('');
  const hidingMixer = useMemo(() => new THREE.AnimationMixer(scenes.startRoom), [scenes.startRoom]);
  const hidingClips = useMemo(() => {
    const stored = scenes.startRoom.userData.lastBellAuthoredAnimations;
    return Array.isArray(stored) ? stored.filter((clip): clip is THREE.AnimationClip => clip instanceof THREE.AnimationClip) : [];
  }, [scenes.startRoom]);
  useLayoutEffect(() => {
    onMounted();
  }, [onMounted, scenes]);
  useEffect(() => () => { hidingMixer.stopAllAction(); }, [hidingMixer]);
  useFrame(() => {
    const playerZ = playerPositionRef.current?.z ?? 4;
    const doorOpen = (classroomDoorRef.current?.openProgress ?? 0) > .025;
    // This wall is a real portal boundary. Avoid drawing the entire corridor
    // through a closed opaque slider; once the player crosses, retire the
    // classroom behind them. The brief overlap while the door moves keeps the
    // physical, non-teleport traversal visually continuous.
    const startRoomVisible = !exteriorEntry && playerZ < 13.55;
    const firstBayVisible = !exteriorEntry && (doorOpen || playerZ > 12.6);
    if (startRoomRef.current) startRoomRef.current.visible = startRoomVisible;
    if (firstBayRef.current) firstBayRef.current.visible = firstBayVisible;
    const visibilityKey = `${startRoomVisible}:${firstBayVisible}`;
    if (visibilityKey !== lastVisibilityRef.current) {
      lastVisibilityRef.current = visibilityKey;
      publishRuntimeQa({ portalVisibility: { startRoom: startRoomVisible, firstBay: firstBayVisible } });
    }
    syncLastBellHidingSpotAnimations(hidingMixer, hidingClips, playerStealth);
    applyLastBellHidingSpotVisuals(scenes.startRoom, playerStealth);
  });
  return (
    <group name="LastBellAuthoredEnvironment">
      <primitive object={scenes.entry} visible={exteriorEntry} dispose={null} />
      <group visible={!exteriorEntry}>
        <group ref={startRoomRef}><primitive object={scenes.startRoom} dispose={null} /></group>
        <group ref={firstBayRef} visible={false}>
          {scenes.firstBay ? <primitive object={scenes.firstBay} dispose={null} /> : null}
        </group>
        <AuthoredDoor scene={scenes.classroomDoor} snapshotRef={classroomDoorRef} />
      </group>
    </group>
  );
}

/**
 * Local-only GLB/KTX2 loader. It deliberately mounts no procedural scene:
 * a failed critical opening pack is fail-closed so the campaign retry CTA can
 * restore the authored contract instead of substituting visible primitives.
 */
export function AuthoredEnvironment3d({ entryPhase, classroomDoorRef, playerPositionRef, playerStealth, quality, onMounted, retryNonce = 0, onAssetStatus }: AuthoredEnvironment3dProps) {
  const { gl } = useThree();
  const [scenes, setScenes] = useState<AuthoredSceneSet | null>(null);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(false);
  const maxAnisotropy = useMemo(() => Math.min(gl.capabilities.getMaxAnisotropy(), 4), [gl]);

  useEffect(() => {
    let cancelled = false;
    publishRuntimeQa({ assetMode: 'loading', loadedIds: [], decodedBounds: {}, tier: quality.id });
    const ktx2Loader = getLastBellKtx2Loader(gl);
    const gltfLoader = new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(ktx2Loader)
      .setResourcePath('/generated/last-bell/3d/');

    const prepareScene = async (
      assetId: LastBellEnvironment3dAssetId,
      metadata: EnvironmentMetadata,
    ): Promise<THREE.Object3D> => {
      const gltf = await gltfLoader.loadAsync(runtimeAssetPath(assetId));
      const scene = cloneSceneForRuntime(gltf.scene, maxAnisotropy, assetId === 'classroomDoor');
      scene.userData.lastBellAuthoredAnimations = gltf.animations;
      const bindings = selectLastBellLightmapBindings(
        [...metadataBindingsForAsset(metadata, assetId), ...extrasBindingsForScene(scene)],
        quality,
      );
      await Promise.all(bindings.map(async (binding) => {
        try {
          const texture = await ktx2Loader.loadAsync(toLocalGeneratedUrl(binding.path));
          applyLightmapBinding(scene, binding, texture, maxAnisotropy);
        } catch (error) {
          // Lightmaps are an optional tier enhancement. A valid GLB must
          // still mount with its authored PBR materials if a particular
          // KTX2 variant was omitted from this quality pack.
          console.warn(`Last Bell lightmap omitted: ${binding.path}`, error);
        }
      }));
      return scene;
    };

    const load = async () => {
      try {
        const metadataResponse = await fetch(LAST_BELL_ASSETS.environment3d.metadata, { cache: 'no-cache' });
        if (!metadataResponse.ok) throw new Error(`Unable to load Last Bell 3D metadata (${metadataResponse.status})`);
        const metadata = await metadataResponse.json() as EnvironmentMetadata;
        // Entry, the cold-open room, and the simulation-owned door are the
        // readiness boundary. Load those independent resources in parallel;
        // the corridor bay starts only after that core commits, so it cannot
        // contend with the first visible experience for network/decode time.
        const coreEntries = await Promise.all(CORE_ENVIRONMENT_ASSET_IDS.map(async (id) => [
          id,
          await prepareScene(id, metadata),
        ] as const));
        const nextScenes = Object.fromEntries(coreEntries) as CoreAuthoredSceneSet;
        // Validate before setting React state so a malformed door never reveals
        // a static or independently animated substitute for DoorSystem.
        bindAuthoredDoor(nextScenes.classroomDoor);
        if (cancelled) return;
        setScenes(nextScenes);
        publishRuntimeQa({
          assetMode: 'authored',
          loadedIds: [...CORE_ENVIRONMENT_ASSET_IDS],
          decodedBounds: Object.fromEntries(CORE_ENVIRONMENT_ASSET_IDS.map((id) => [id, decodedBounds(nextScenes[id])])),
          tier: quality.id,
        });
        onAssetStatus?.({ failedAssetKeys: [], criticalAssetFailure: false });
        const firstBay = await prepareScene('firstBay', metadata);
        if (cancelled) return;
        setScenes((current) => current ? { ...current, firstBay } : current);
        publishRuntimeQa({
          loadedIds: [...CORE_ENVIRONMENT_ASSET_IDS, 'firstBay'],
          decodedBounds: {
            ...Object.fromEntries(CORE_ENVIRONMENT_ASSET_IDS.map((id) => [id, decodedBounds(nextScenes[id])])),
            firstBay: decodedBounds(firstBay),
          },
        });
      } catch (error) {
        console.error('Last Bell authored environment failed to load; keeping campaign fail-closed.', error);
        if (!cancelled) {
          publishRuntimeQa({ assetMode: 'error', loadedIds: [], decodedBounds: {}, tier: quality.id });
          setScenes(null);
          setFailed(true);
          onAssetStatus?.({ failedAssetKeys: ['opening:environment'], criticalAssetFailure: true });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [gl, maxAnisotropy, onAssetStatus, quality, retryNonce]);

  const reportMounted = () => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    onMounted();
  };

  if (scenes) {
    return <MountedAuthoredEnvironment scenes={scenes} entryPhase={entryPhase} classroomDoorRef={classroomDoorRef} playerPositionRef={playerPositionRef} playerStealth={playerStealth} onMounted={reportMounted} />;
  }
  if (failed) return null;
  return null;
}

export type { AuthoredEnvironment3dProps };
