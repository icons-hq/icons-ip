'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import { zombieAudioOcclusion } from '@/lib/prototypes/last-bell/runtime/audio-occlusion';
import { LAST_BELL_HIDING_SPOTS, LAST_BELL_INTERACTIONS } from '@/lib/prototypes/last-bell/runtime/world';
import type {
  CollectibleKey,
  LastBellSimulationSnapshot,
  LastBellZombieSnapshot,
  LastBellZombieVariant,
} from '@/lib/prototypes/last-bell/runtime/types';
import { LAST_BELL_PRODUCT_ASSETS, type LastBellProductKey } from '../products/assets';
import {
  LAST_BELL_CAMPAIGN_NAMRA_ASSET,
  LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET,
  LAST_BELL_CAMPAIGN_ROUTE_ASSETS,
  LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS,
  LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS,
  LAST_BELL_QA_NAMRA_PRIVATE_ASSET,
  type LastBellQaNamraHybridMode,
  type LastBellCampaignRouteZone,
} from './campaignAssets';
import {
  createRecoverableAssetCache,
  planLastBellCampaignStreaming,
  type LastBellCampaignAssetKey,
} from './campaignStreaming';
import { applyLastBellStreamedDoorVisuals } from './campaignDoorVisuals';
import { applyLastBellHidingSpotVisuals, syncLastBellHidingSpotAnimations } from '../hidingSpotVisuals';
import { getLastBellKtx2Loader } from '../lastBellKtx2Loader';

type LoadedCampaignAsset = Readonly<{
  scene: THREE.Group;
  animations: readonly THREE.AnimationClip[];
}>;

type ItemAnchor = Readonly<{
  id: string;
  key: CollectibleKey;
  chapterId: 'chapter-01' | 'chapter-02';
  zoneId: LastBellSimulationSnapshot['zoneId'];
  position: Readonly<{ x: number; z: number }>;
}>;

const ITEM_ANCHORS: readonly ItemAnchor[] = LAST_BELL_INTERACTIONS.flatMap((interaction) => (
  interaction.kind === 'item' && interaction.collectibleKey
    ? [{
      id: interaction.id,
      key: interaction.collectibleKey,
      chapterId: interaction.chapterId,
      zoneId: interaction.zoneId,
      position: interaction.position,
    }]
    : []
));

const ZOMBIE_CLIPS: Readonly<Record<LastBellZombieSnapshot['state'], string>> = {
  patrol: 'Patrol',
  investigate: 'Investigate',
  search: 'Search',
  chase: 'Chase',
  capture: 'Capture',
};

const ZOMBIE_APPEARANCES = {
  // Character GLBs own their garment, skin, and hair PBR colours. These
  // factors intentionally preserve those maps rather than multiplying every
  // surface into the black/teal mannequin seen in the first-encounter view.
  'uniform-a': { fabric: '#ffffff', stain: '#9b5650', skin: '#f0c6ad' },
  'uniform-b': { fabric: '#ffffff', stain: '#8f5148', skin: '#e5bda7' },
  'uniform-c': { fabric: '#ffffff', stain: '#80504a', skin: '#dcb39f' },
} as const;
const ZOMBIE_POSITIONAL_AUDIO = '/generated/last-bell/audio/distant-infected-groan.ogg';
const CHARACTER_GROUND_OFFSET_Y = 0;

function disposeCampaignAsset(asset: LoadedCampaignAsset): void {
  asset.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function disposeCloneMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

let campaignRenderer: THREE.WebGLRenderer | null = null;
let campaignGltfLoader: GLTFLoader | null = null;

function configureCampaignGltfLoader(renderer: THREE.WebGLRenderer): void {
  if (campaignRenderer === renderer && campaignGltfLoader) return;
  campaignRenderer = renderer;
  campaignGltfLoader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(getLastBellKtx2Loader(renderer));
}

const CAMPAIGN_GLTFS = createRecoverableAssetCache<string, LoadedCampaignAsset>(
  async (url) => {
    if (!campaignGltfLoader) throw new Error('campaign_renderer_not_ready');
    const gltf = await campaignGltfLoader.loadAsync(url);
    return { scene: gltf.scene, animations: gltf.animations };
  },
  disposeCampaignAsset,
);

type CampaignGltfState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  asset: LoadedCampaignAsset | null;
  error: Error | null;
}>;

function publishCampaignAssetQa(value: Record<string, unknown>): void {
  const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
  scope.__ICONS_LAST_BELL_QA__ = {
    ...scope.__ICONS_LAST_BELL_QA__,
    campaignAssets: value,
  };
}

function useCampaignGltf(url: string, enabled: boolean, retryNonce: number): CampaignGltfState {
  const [state, setState] = useState<CampaignGltfState>({ status: 'idle', asset: null, error: null });
  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      queueMicrotask(() => {
        if (!cancelled) setState({ status: 'idle', asset: null, error: null });
      });
      return () => { cancelled = true; };
    }
    queueMicrotask(() => {
      if (!cancelled) setState({ status: 'loading', asset: null, error: null });
    });
    void CAMPAIGN_GLTFS.acquire(url).then((asset) => {
      if (!cancelled) setState({ status: 'ready', asset, error: null });
    }, (error: unknown) => {
      if (!cancelled) {
        setState({
          status: 'error',
          asset: null,
          error: error instanceof Error ? error : new Error('campaign_asset_load_failed'),
        });
      }
    });
    return () => {
      cancelled = true;
      CAMPAIGN_GLTFS.release(url);
    };
  }, [enabled, retryNonce, url]);
  return state;
}

function playClip(
  mixer: THREE.AnimationMixer,
  clips: readonly THREE.AnimationClip[],
  previous: THREE.AnimationAction | null,
  name: string,
  reducedMotion: boolean,
): THREE.AnimationAction | null {
  const clip = clips.find((candidate) => candidate.name === name) ?? clips[0];
  if (!clip) return null;
  const next = mixer.clipAction(clip);
  if (previous && previous !== next) previous.fadeOut(.13);
  next.reset().fadeIn(previous ? .13 : 0).play();
  next.timeScale = reducedMotion ? 0 : 1;
  return next;
}

function applyZombieAppearance(root: THREE.Object3D, variant: LastBellZombieSnapshot['variant']): void {
  const palette = ZOMBIE_APPEARANCES[variant];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const hadMaterialArray = Array.isArray(object.material);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = materials.map((source) => {
      const material = source.clone();
      const materialName = material.name.toLowerCase();
      const isInfection = materialName.includes('stain') || materialName.includes('infection');
      const isSkin = materialName.includes('skin') || materialName.includes('sclera') || materialName.includes('iris');
      const isHair = materialName.includes('hair');
      const isFootwear = materialName.includes('footwear') || materialName.includes('socks');
      const readableColor = isInfection ? palette.stain : isSkin ? palette.skin : isHair ? '#3a241f' : isFootwear ? '#d5ddd8' : palette.fabric;
      if (materialName.includes('uniform') || materialName.includes('cardigan') || materialName.includes('skirt')) material.color.set(palette.fabric);
      if (isInfection) material.color.set(palette.stain);
      if (isSkin) material.color.set(palette.skin);
      if (isHair) material.color.set('#3a241f');
      if (isFootwear) material.color.set('#d5ddd8');
      // Preserve authored maps while separating the actor from the far wall.
      if ('emissive' in material && material.emissive instanceof THREE.Color) {
        // The first-bay fixture is intentionally sparse; retain a very low
        // material-local bounce so skin, cloth, footwear and hair do not
        // collapse into one black silhouette between its pools. This is not a
        // fallback material and leaves every authored base/normal/ORM map on.
        material.emissive.set(readableColor);
        material.emissiveIntensity = isInfection ? .18 : isHair ? .08 : isSkin ? .30 : .24;
      }
      material.roughness = Math.min(1, material.roughness + .06);
      return material;
    });
    // A single-material glTF primitive has no geometry groups. Converting its
    // material to a one-entry array makes Three render zero groups, which hid
    // every garment/hair primitive even though the GLB and skin were loaded.
    object.material = hadMaterialArray ? clonedMaterials : clonedMaterials[0]!;
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
}

function SharedRigZombie({ zombie, source, reducedMotion }: {
  zombie: LastBellZombieSnapshot;
  source: LoadedCampaignAsset;
  reducedMotion: boolean;
}) {
  const root = useMemo(() => {
    const cloned = cloneSkeleton(source.scene);
    applyZombieAppearance(cloned, zombie.variant);
    return cloned;
  }, [source.scene, zombie.variant]);
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const reportedBoundsRef = useRef(false);

  useEffect(() => {
    actionRef.current = playClip(mixer, source.animations, actionRef.current, ZOMBIE_CLIPS[zombie.state], reducedMotion);
  }, [mixer, reducedMotion, source.animations, zombie.state]);

  useEffect(() => {
    return () => {
      mixer.stopAllAction();
      disposeCloneMaterials(root);
    };
  }, [mixer, root]);
  useFrame((_, delta) => {
    if (!reducedMotion) mixer.update(Math.min(delta, .05));
    if (!reportedBoundsRef.current && groupRef.current) {
      // Use the SkinnedMesh override so bindMatrixInverse is refreshed before
      // CPU-side QA bounds are sampled. Object3D.updateWorldMatrix alone left
      // the bind inverse stale and falsely reported every actor at 2x world
      // translation even though the renderer placed it correctly.
      groupRef.current.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(groupRef.current, true);
      const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
      const previous = scope.__ICONS_LAST_BELL_QA__?.renderedActors;
      scope.__ICONS_LAST_BELL_QA__ = {
        ...scope.__ICONS_LAST_BELL_QA__,
        renderedActors: {
          ...(typeof previous === 'object' && previous ? previous : {}),
          [zombie.id]: {
            assetMounted: true,
            childCount: root.children.length,
            bounds: {
              min: bounds.min.toArray().map((value) => Number(value.toFixed(3))),
              max: bounds.max.toArray().map((value) => Number(value.toFixed(3))),
            },
          },
        },
      };
      reportedBoundsRef.current = true;
    }
  });

  return (
    <group
      ref={groupRef}
      name={`enemy.${zombie.id}`}
      position={[zombie.position.x, 0, zombie.position.z]}
      rotation={[0, zombie.facingRadians, 0]}
      userData={{ semanticActor: zombie.id, state: zombie.state, variant: zombie.variant, facingRadians: zombie.facingRadians }}
    >
      <primitive object={root} position={[0, CHARACTER_GROUND_OFFSET_Y, 0]} />
      {/* A damaged fixture above the first encounter has a deliberately
          short, motivated pool. It reveals the authored face, fabric and
          nearby wreckage without lifting the entire corridor into flat fill. */}
      <pointLight position={[0, 2.85, -.22]} color="#c8e6df" intensity={10.5} distance={7.2} decay={1.65} castShadow={false} />
      <pointLight position={[-.58, 1.20, -1.05]} color="#88b7b3" intensity={2.4} distance={3.8} decay={1.8} castShadow={false} />
    </group>
  );
}

/** One listener follows the camera while the groan stays at the live actor. */
function PositionalZombieAudio({ zombie, playerPosition, doors, active }: {
  zombie: LastBellZombieSnapshot;
  playerPosition: LastBellSimulationSnapshot['player']['position'];
  doors: LastBellSimulationSnapshot['doors']['doors'];
  active: boolean;
}) {
  const { camera, scene } = useThree();
  const soundRef = useRef<THREE.PositionalAudio | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const activeRef = useRef(active);
  const positionRef = useRef(new THREE.Vector3());

  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    let disposed = false;
    const listener = new THREE.AudioListener();
    const sound = new THREE.PositionalAudio(listener);
    sound.setRefDistance(3.2);
    sound.setRolloffFactor(1.35);
    sound.setDistanceModel('inverse');
    sound.setLoop(true);
    sound.setVolume(.14);
    const filter = listener.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 6_500;
    sound.setFilter(filter);
    filterRef.current = filter;
    camera.add(listener);
    // PositionalAudio must participate in the scene graph so Three updates
    // its world matrix and WebAudio panner from the same actor transform that
    // is visible on screen. Merely mutating an unattached Object3D position
    // leaves the panner at its stale origin.
    scene.add(sound);
    soundRef.current = sound;
    new THREE.AudioLoader().load(ZOMBIE_POSITIONAL_AUDIO, (buffer) => {
      if (disposed) return;
      sound.setBuffer(buffer);
      if (activeRef.current) {
        void listener.context.resume().then(() => {
          if (!disposed && activeRef.current && !sound.isPlaying) sound.play();
        }).catch(() => undefined);
      }
    });
    return () => {
      disposed = true;
      if (sound.isPlaying) sound.stop();
      scene.remove(sound);
      camera.remove(listener);
      filterRef.current = null;
      soundRef.current = null;
    };
  }, [camera, scene]);

  useEffect(() => {
    const sound = soundRef.current;
    if (!sound?.buffer) return;
    if (!active && sound.isPlaying) {
      sound.pause();
      return;
    }
    if (active && !sound.isPlaying) void sound.context.resume().then(() => sound.play()).catch(() => undefined);
  }, [active]);

  useFrame(() => {
    const sound = soundRef.current;
    if (!sound) return;
    const mix = zombieAudioOcclusion(playerPosition, zombie.position, doors);
    positionRef.current.set(zombie.position.x, 1.18, zombie.position.z);
    sound.position.copy(positionRef.current);
    sound.updateMatrixWorld();
    sound.setVolume(mix.gain);
    if (filterRef.current) filterRef.current.frequency.value = mix.lowpassHz;
  });

  return null;
}

const HYBRID_CARD_NAMES = {
  // The GLB's nodes retain their semantic pose names; the underlying mesh
  // resources have a separate `CardMesh` name and are not what Three renders.
  'idle-2p8': 'NamraImpostor_idle-front-2p8m',
  'idle-6': 'NamraImpostor_idle-front-6m',
  'idle-oblique': 'NamraImpostor_alert-profile',
  'recognition-2p8': 'NamraImpostor_recognition-three-quarter',
  'subdue-2p8': 'NamraImpostor_subdue-dash',
} as const;

type HybridCardState = Readonly<{
  mesh: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
}>;

function hybridCardsIn(root: THREE.Object3D): Map<string, HybridCardState> {
  const cards = new Map<string, HybridCardState>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith('NamraImpostor_')) return;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((source) => {
      const material = source.clone();
      material.transparent = true;
      material.depthWrite = false;
      material.opacity = 0;
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0]!;
    object.scale.setScalar(0);
    object.visible = false;
    cards.set(object.name, { mesh: object, materials });
  });
  return cards;
}

function setHybridCardOpacity(card: HybridCardState | undefined, opacity: number): void {
  if (!card) return;
  const visible = opacity > .001;
  card.mesh.visible = visible;
  card.mesh.scale.setScalar(visible ? 1 : 0);
  for (const material of card.materials) material.opacity = opacity;
}

function disposeHybridCards(cards: Map<string, HybridCardState>): void {
  for (const card of cards.values()) {
    for (const material of card.materials) material.dispose();
  }
}

function RooftopCharacter({ source, phase, phaseElapsedSeconds, reducedMotion, qaNamraHybridMode }: {
  source: LoadedCampaignAsset;
  phase: LastBellSimulationSnapshot['rooftopPhase'];
  phaseElapsedSeconds: number;
  reducedMotion: boolean;
  qaNamraHybridMode?: LastBellQaNamraHybridMode | null;
}) {
  const { camera } = useThree();
  const root = useMemo(() => cloneSkeleton(source.scene), [source.scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const cards = useMemo(
    () => qaNamraHybridMode ? hybridCardsIn(root) : new Map<string, HybridCardState>(),
    [qaNamraHybridMode, root],
  );
  const transitionRef = useRef<Readonly<{ from: string | null; to: string; elapsed: number }> | null>(null);
  const activeCardRef = useRef<string | null>(null);
  const qaSequenceSecondsRef = useRef(0);
  const carrierRef = useRef<THREE.Group>(null);
  const clip = phase === 'recognition' ? 'Detect_Threat' : phase === 'subdue' || phase === 'black' ? 'Restrain' : 'Idle_Rooftop';

  useEffect(() => {
    actionRef.current = playClip(mixer, source.animations, actionRef.current, clip, reducedMotion);
    return () => { mixer.stopAllAction(); };
  }, [clip, mixer, reducedMotion, source.animations]);
  useEffect(() => () => disposeHybridCards(cards), [cards]);
  useFrame((_, delta) => {
    if (!reducedMotion) mixer.update(Math.min(delta, .05));
    if (!qaNamraHybridMode) return;

    if (qaNamraHybridMode === 'sequence') qaSequenceSecondsRef.current += Math.min(delta, .05);
    else qaSequenceSecondsRef.current = 0;
    const sequenceSeconds = qaSequenceSecondsRef.current;
    const effectiveMode: Exclude<LastBellQaNamraHybridMode, 'sequence'> = qaNamraHybridMode === 'sequence'
      ? sequenceSeconds < 1 ? 'idle-2p8' : sequenceSeconds < 2.25 ? 'recognition-2p8' : 'subdue-2p8'
      : qaNamraHybridMode;
    const desired = HYBRID_CARD_NAMES[effectiveMode];
    const desiredCard = cards.get(desired);
    // Fast Refresh can retain the selected pose ref while remounting the GLB
    // clone with every card hidden. Treat that mount state as an initial
    // selection, otherwise the local visual gate falsely reports a mount with
    // no visible subject.
    if (activeCardRef.current !== desired || !desiredCard?.mesh.visible) {
      const priorCard = activeCardRef.current ? cards.get(activeCardRef.current) : undefined;
      transitionRef.current = { from: priorCard?.mesh.visible ? activeCardRef.current : null, to: desired, elapsed: 0 };
      activeCardRef.current = desired;
      setHybridCardOpacity(desiredCard, 0);
    }
    const transition = transitionRef.current;
    if (transition) {
      const elapsed = transition.elapsed + Math.min(delta, .05);
      const amount = Math.min(1, elapsed / .18);
      setHybridCardOpacity(cards.get(transition.to), amount);
      if (transition.from) setHybridCardOpacity(cards.get(transition.from), 1 - amount);
      if (amount >= 1) transitionRef.current = null;
      else transitionRef.current = { ...transition, elapsed };
    }
    for (const card of cards.values()) {
      if (card.mesh.visible) card.mesh.lookAt(camera.position);
    }
    // This is only a local review cue for the card's dynamic pose: all story
    // state remains simulation-owned, and the candidate never changes the
    // shipped character contract until a human visual approval exists.
    const dashSeconds = qaNamraHybridMode === 'sequence'
      ? Math.max(0, sequenceSeconds - 2.25)
      : phaseElapsedSeconds;
    if (carrierRef.current) {
      carrierRef.current.position.z = 101.5 + (effectiveMode === 'subdue-2p8'
        ? -Math.min(2.15, Math.max(.12, dashSeconds) * 5.4)
        : 0);
    }
    if (carrierRef.current) {
      carrierRef.current.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(carrierRef.current, true);
      const activeCard = cards.get(desired);
      const projectedCenter = activeCard
        ? activeCard.mesh.getWorldPosition(new THREE.Vector3()).project(camera).toArray()
        : null;
      const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
      scope.__ICONS_LAST_BELL_QA__ = {
        ...scope.__ICONS_LAST_BELL_QA__,
        privateNamraHybrid: {
          mounted: true,
          mode: qaNamraHybridMode,
          selectedCard: desired,
          transition: transitionRef.current ? { ...transitionRef.current } : null,
          visibleCards: [...cards].filter(([, card]) => card.mesh.visible).map(([name]) => name),
          worldBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
          activeCard: activeCard ? {
            scale: activeCard.mesh.scale.toArray(),
            projectedCenter,
            materialOpacity: activeCard.materials[0]?.opacity ?? null,
            textureReady: Boolean(activeCard.materials[0]?.map),
          } : null,
          source: 'private-image-based-hybrid',
          releaseAllowed: false,
        },
      };
    }
  });

  if (phase === 'sealed' || phase === 'black') return null;
  return (
    <group
      ref={carrierRef}
      position={[0, qaNamraHybridMode ? 1 : CHARACTER_GROUND_OFFSET_Y, 101.5]}
      rotation={[0, Math.PI, 0]}
      userData={{
        semanticActor: 'character.namra.rooftop',
        assetContract: qaNamraHybridMode ? 'private-image-based-hybrid-review-only' : 'human-review-blocked',
        qaNamraHybridMode: qaNamraHybridMode ?? null,
      }}
    >
      <primitive object={root} />
    </group>
  );
}

function StreamedCampaignRoute({ zoneId, source, doors, playerStealth }: {
  zoneId: LastBellCampaignRouteZone;
  source: LoadedCampaignAsset;
  doors: LastBellSimulationSnapshot['doors'];
  playerStealth: Pick<LastBellSimulationSnapshot['player'], 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>;
}) {
  const root = useMemo(() => source.scene.clone(true), [source.scene]);
  const hidingMixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const rootRef = useRef<THREE.Group>(null);
  const doorsRef = useRef(doors);
  useEffect(() => {
    doorsRef.current = doors;
  }, [doors]);
  useEffect(() => () => { hidingMixer.stopAllAction(); }, [hidingMixer]);
  useFrame(() => {
    if (!rootRef.current) return;
    applyLastBellStreamedDoorVisuals(rootRef.current, doorsRef.current);
    syncLastBellHidingSpotAnimations(hidingMixer, source.animations, playerStealth);
    applyLastBellHidingSpotVisuals(rootRef.current, playerStealth);
  });
  return (
    <primitive
      ref={rootRef}
      object={root}
      name={`last-bell.route.${zoneId}`}
      position={LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS[zoneId]}
      userData={{ semanticZone: zoneId, streamed: true }}
    />
  );
}

function InteractionAnchor({ id, kind, x, y = .34, z, reducedMotion }: {
  id: string;
  kind: string;
  x: number;
  y?: number;
  z: number;
  reducedMotion: boolean;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ringRef.current || reducedMotion) return;
    ringRef.current.rotation.z = state.clock.elapsedTime * .7;
  });
  return (
    <group name={`interaction.${id}`} position={[x, y, z]} userData={{ semanticInteraction: id, interactionKind: kind }}>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} castShadow={false} receiveShadow={false}>
        <torusGeometry args={[.22, .014, 6, 18]} />
        <meshBasicMaterial color="#83e4de" transparent opacity={.8} depthWrite={false} />
      </mesh>
      <pointLight color="#7bded8" intensity={.4} distance={2.4} decay={2} castShadow={false} />
    </group>
  );
}

function ProductAtWorldAnchor({ anchor, enabled, reducedMotion, retryNonce }: {
  anchor: ItemAnchor;
  enabled: boolean;
  reducedMotion: boolean;
  retryNonce: number;
}) {
  const product = LAST_BELL_PRODUCT_ASSETS[anchor.key as LastBellProductKey];
  const placement = product.worldPlacement;
  const source = useCampaignGltf(product.model, enabled, retryNonce);
  const root = useMemo(() => source.asset?.scene.clone(true) ?? null, [source.asset]);
  const spinRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!spinRef.current || reducedMotion) return;
    spinRef.current.rotation.y = Math.sin(state.clock.elapsedTime * .7) * .1;
  });
  if (!root) return null;
  return (
    <group
      ref={spinRef}
      name={`product.${anchor.key}`}
      position={[anchor.position.x, placement.y, anchor.position.z]}
      rotation={placement.rotation}
      scale={[placement.scale, placement.scale, placement.scale]}
      userData={{
        semanticAnchor: product.semanticAnchor,
        collectibleKey: anchor.key,
        interactionId: anchor.id,
        authoredSupport: placement.support,
      }}
    >
      <primitive object={root} />
    </group>
  );
}

function CampfireLight({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const light = lightRef.current;
    if (!light || reducedMotion) return;
    light.intensity = active ? 10.5 + Math.sin(state.clock.elapsedTime * 13) * 1.2 : 0;
  });
  if (!active) return null;
  return (
    <>
      <pointLight ref={lightRef} position={[2.8, 1.1, 98.7]} color="#ff7531" intensity={10.5} distance={12} decay={1.95} castShadow={false} />
      <directionalLight position={[-5, 8, 92]} color="#5fabad" intensity={.54} castShadow={false} />
    </>
  );
}

/**
 * Mount inside the existing LastBellRuntime Canvas.
 *
 * Props: `{ snapshot: LastBellSimulationSnapshot; reducedMotion: boolean;
 * entryPhase: EntryDirectorPhase }`. It only projects snapshot state; all
 * interaction, collision, progression and rewards remain simulation/host-owned.
 */
export function TwoChapterWorldScene({
  snapshot,
  reducedMotion,
  entryPhase,
  assetRetryNonce,
  qaNamraHybridMode = null,
  onEnvironmentMounted,
  onAssetStatus,
}: {
  snapshot: LastBellSimulationSnapshot;
  reducedMotion: boolean;
  entryPhase: EntryDirectorPhase;
  assetRetryNonce: number;
  /** Local development visual gate; never maps to a production asset. */
  qaNamraHybridMode?: LastBellQaNamraHybridMode | null;
  onEnvironmentMounted?: () => void;
  onAssetStatus?: (status: Readonly<{ failedAssetKeys: readonly LastBellCampaignAssetKey[]; criticalAssetFailure: boolean }>) => void;
}) {
  const gl = useThree((state) => state.gl);
  configureCampaignGltfLoader(gl);
  const qaHybrid = qaNamraHybridMode !== null;
  const qaRooftopPhase: LastBellSimulationSnapshot['rooftopPhase'] = qaNamraHybridMode === 'recognition-2p8'
    ? 'recognition'
    : qaNamraHybridMode === 'subdue-2p8'
      ? 'subdue'
      : 'approach';
  const visualZoneId = qaHybrid ? 'rooftop' : snapshot.zoneId;
  const visualRooftopPhase = qaHybrid ? qaRooftopPhase : snapshot.rooftopPhase;
  const visualEntryPhase = qaHybrid ? 'playing' : entryPhase;
  const streaming = useMemo(() => planLastBellCampaignStreaming({
    entryPhase: visualEntryPhase,
    zoneId: visualZoneId,
    liveZombieCount: snapshot.zombies.length,
    liveZombieVariants: snapshot.zombies
      .slice(0, LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.maxLiveZombies)
      .map((zombie) => zombie.variant),
    rooftopPhase: visualRooftopPhase,
  }), [snapshot.zombies, visualEntryPhase, visualRooftopPhase, visualZoneId]);
  const corridorRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.corridor,
    streaming.requestedRouteZones.includes('corridor'),
    assetRetryNonce,
  );
  const infirmaryRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.infirmary,
    streaming.requestedRouteZones.includes('infirmary'),
    assetRetryNonce,
  );
  const broadcastRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.broadcast,
    streaming.requestedRouteZones.includes('broadcast'),
    assetRetryNonce,
  );
  const utilityRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.utility,
    streaming.requestedRouteZones.includes('utility'),
    assetRetryNonce,
  );
  const stairwellRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.stairwell,
    streaming.requestedRouteZones.includes('stairwell'),
    assetRetryNonce,
  );
  const rooftopRoute = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ROUTE_ASSETS.rooftop,
    streaming.requestedRouteZones.includes('rooftop'),
    assetRetryNonce,
  );
  const uniformAZombie = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-a'],
    streaming.requestedZombieVariants.includes('uniform-a'),
    assetRetryNonce,
  );
  const uniformBZombie = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-b'],
    streaming.requestedZombieVariants.includes('uniform-b'),
    assetRetryNonce,
  );
  const uniformCZombie = useCampaignGltf(
    LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-c'],
    streaming.requestedZombieVariants.includes('uniform-c'),
    assetRetryNonce,
  );
  const namra = useCampaignGltf(
    qaHybrid ? LAST_BELL_QA_NAMRA_PRIVATE_ASSET : LAST_BELL_CAMPAIGN_NAMRA_ASSET,
    streaming.requestedNamra,
    assetRetryNonce,
  );
  const routeByZone = useMemo<Readonly<Record<LastBellCampaignRouteZone, CampaignGltfState>>>(() => ({
    corridor: corridorRoute,
    infirmary: infirmaryRoute,
    broadcast: broadcastRoute,
    utility: utilityRoute,
    stairwell: stairwellRoute,
    rooftop: rooftopRoute,
  }), [broadcastRoute, corridorRoute, infirmaryRoute, rooftopRoute, stairwellRoute, utilityRoute]);
  const zombieByVariant = useMemo<Readonly<Record<LastBellZombieVariant, CampaignGltfState>>>(() => ({
    'uniform-a': uniformAZombie,
    'uniform-b': uniformBZombie,
    'uniform-c': uniformCZombie,
  }), [uniformAZombie, uniformBZombie, uniformCZombie]);
  const mountedRef = useRef(false);
  const pastRooftopDoor = visualRooftopPhase !== 'sealed';
  const claimed = useMemo(
    () => new Set([...snapshot.collectedThisRun, ...snapshot.committedCollectibles, ...snapshot.pendingCollectibles]),
    [snapshot.collectedThisRun, snapshot.committedCollectibles, snapshot.pendingCollectibles],
  );
  const streamedZones = useMemo(
    () => new Set([...streaming.criticalZones, ...streaming.prefetchZones]),
    [streaming.criticalZones, streaming.prefetchZones],
  );
  const interactions = pastRooftopDoor
    ? snapshot.availableInteractions.filter((interaction) => interaction.kind === 'character')
    : snapshot.availableInteractions;
  const currentRouteState = streaming.requestedRouteZones.find((zone) => zone === visualZoneId)
    ? routeByZone[visualZoneId as LastBellCampaignRouteZone]
    : null;

  useEffect(() => {
    if (!currentRouteState?.asset || mountedRef.current) return;
    mountedRef.current = true;
    onEnvironmentMounted?.();
  }, [currentRouteState?.asset, currentRouteState?.status, onEnvironmentMounted]);

  const failedAssetKeys = useMemo<LastBellCampaignAssetKey[]>(() => [
    ...streaming.requestedRouteZones
      .filter((zone) => routeByZone[zone].status === 'error')
      .map((zone) => `route:${zone}` as const),
    ...streaming.requestedZombieVariants
      .filter((variant) => zombieByVariant[variant].status === 'error')
      .map((variant) => `zombie:${variant}` as const),
    ...(streaming.requestedNamra && namra.status === 'error' ? ['namra:rooftop' as const] : []),
  ], [
    namra.status,
    routeByZone,
    streaming.requestedNamra,
    streaming.requestedRouteZones,
    streaming.requestedZombieVariants,
    zombieByVariant,
  ]);

  useEffect(() => {
    const requested = [
      ...streaming.requestedRouteZones.map((zone) => ({ key: `route:${zone}`, status: routeByZone[zone].status })),
      ...streaming.requestedZombieVariants.map((variant) => ({ key: `zombie:${variant}`, status: zombieByVariant[variant].status })),
      ...(streaming.requestedNamra ? [{ key: 'namra:rooftop', status: namra.status }] : []),
    ];
    publishCampaignAssetQa({
      currentZone: visualZoneId,
      criticalZones: [...streaming.criticalZones],
      prefetchZones: [...streaming.prefetchZones],
      requested,
      failedAssetKeys,
      criticalAssetFailure: failedAssetKeys.length > 0,
    });
    onAssetStatus?.({
      failedAssetKeys,
      criticalAssetFailure: failedAssetKeys.length > 0,
    });
  }, [
    failedAssetKeys,
    namra.status,
    onAssetStatus,
    routeByZone,
    visualZoneId,
    streaming.criticalZones,
    streaming.prefetchZones,
    streaming.requestedNamra,
    streaming.requestedRouteZones,
    streaming.requestedZombieVariants,
    zombieByVariant,
  ]);

  return (
    <group name="last-bell.two-chapter.world">
      {streaming.requestedRouteZones.map((zoneId) => {
        const route = routeByZone[zoneId];
        if (route.asset) return <StreamedCampaignRoute key={zoneId} zoneId={zoneId} source={route.asset} doors={snapshot.doors} playerStealth={snapshot.player} />;
        return null;
      })}
      {!pastRooftopDoor && snapshot.zombies.slice(0, LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.maxLiveZombies).map((actor) => {
        const zombie = zombieByVariant[actor.variant];
        if (zombie.asset) return <SharedRigZombie key={actor.id} zombie={actor} source={zombie.asset} reducedMotion={reducedMotion} />;
        // Do not substitute a capsule for a failed production actor. Keep the
        // semantic simulation/live audio and expose the existing retry CTA.
        return null;
      })}
      {!pastRooftopDoor && snapshot.zombies
        .slice(0, LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET.maxLiveZombies)
        .filter((actor) => zombieByVariant[actor.variant].asset)
        .map((actor) => (
          <PositionalZombieAudio
            key={`audio.${actor.id}`}
            zombie={actor}
            playerPosition={snapshot.player.position}
            doors={snapshot.doors.doors}
            active={entryPhase === 'playing'}
          />
        ))}
      {streaming.requestedNamra && namra.asset ? (
        <RooftopCharacter
          source={namra.asset}
          phase={visualRooftopPhase}
          phaseElapsedSeconds={qaHybrid ? 0.28 : snapshot.rooftopPhaseElapsedSeconds}
          reducedMotion={reducedMotion}
          qaNamraHybridMode={qaNamraHybridMode}
        />
      ) : null}
      {LAST_BELL_HIDING_SPOTS.map((spot) => (
        <group
          key={spot.id}
          name={spot.semanticNode}
          position={[spot.position.x, 0, spot.position.z]}
          userData={{ semanticHidingSpot: spot.id, animationSeam: 'PlayerStealthState' }}
        />
      ))}
      {interactions.map((interaction) => (
        <InteractionAnchor
          key={interaction.id}
          id={interaction.id}
          kind={interaction.kind}
          x={interaction.position.x}
          y={interaction.collectibleKey
            ? LAST_BELL_PRODUCT_ASSETS[interaction.collectibleKey].worldPlacement.y
            : undefined}
          z={interaction.position.z}
          reducedMotion={reducedMotion}
        />
      ))}
      {!pastRooftopDoor && ITEM_ANCHORS.map((anchor) => (
        <ProductAtWorldAnchor
          key={anchor.id}
          anchor={anchor}
          enabled={anchor.chapterId === snapshot.chapterId && streamedZones.has(anchor.zoneId) && !claimed.has(anchor.key)}
          reducedMotion={reducedMotion}
          retryNonce={assetRetryNonce}
        />
      ))}
      <CampfireLight active={pastRooftopDoor && snapshot.rooftopPhase !== 'black'} reducedMotion={reducedMotion} />
    </group>
  );
}

export default TwoChapterWorldScene;
