/**
 * Runtime contract for the authored Chapter 1 geometry. These URLs are kept
 * independent of the R3F loader so tests and the asset pipeline can verify the
 * public pack without needing a browser or WebGL context.
 */
export const LAST_BELL_3D_ROOT = '/generated/last-bell/3d/' as const;

export const LAST_BELL_3D_ASSET_PATHS = {
  entry: `${LAST_BELL_3D_ROOT}entry.glb`,
  startRoom: `${LAST_BELL_3D_ROOT}start-room.glb`,
  firstBay: `${LAST_BELL_3D_ROOT}first-bay.glb`,
  classroomDoor: `${LAST_BELL_3D_ROOT}classroom-door.glb`,
  metadata: `${LAST_BELL_3D_ROOT}metadata.json`,
  basisTranscoder: `${LAST_BELL_3D_ROOT}basis/`,
  lightmaps: `${LAST_BELL_3D_ROOT}lightmaps/`,
} as const;

/** Concrete files fetched by the browser. Directory roots above are loader
 * configuration and are therefore intentionally excluded from this list. */
export const LAST_BELL_3D_DELIVERY_FILE_PATHS = [
  LAST_BELL_3D_ASSET_PATHS.entry,
  LAST_BELL_3D_ASSET_PATHS.startRoom,
  LAST_BELL_3D_ASSET_PATHS.firstBay,
  LAST_BELL_3D_ASSET_PATHS.classroomDoor,
  LAST_BELL_3D_ASSET_PATHS.metadata,
  `${LAST_BELL_3D_ASSET_PATHS.basisTranscoder}basis_transcoder.js`,
  `${LAST_BELL_3D_ASSET_PATHS.basisTranscoder}basis_transcoder.wasm`,
  `${LAST_BELL_3D_ASSET_PATHS.lightmaps}entry-medium.ktx2`,
  `${LAST_BELL_3D_ASSET_PATHS.lightmaps}start-room-medium.ktx2`,
  `${LAST_BELL_3D_ASSET_PATHS.lightmaps}first-bay-medium.ktx2`,
] as const;

export type LastBellEnvironment3dAssetId = keyof Pick<
  typeof LAST_BELL_3D_ASSET_PATHS,
  'entry' | 'startRoom' | 'firstBay' | 'classroomDoor'
>;

export const LAST_BELL_DOOR_SEMANTIC_NODE_NAMES = [
  'Door_Frame',
  'Door_Rail',
  'Door_Panel_L',
  'Door_Panel_R',
  'Door_Glass_L',
  'Door_Glass_R',
] as const;

export type LastBellDoorSemanticNodeName = typeof LAST_BELL_DOOR_SEMANTIC_NODE_NAMES[number];

export type LastBellDoorSemanticValidation = Readonly<{
  valid: boolean;
  missing: readonly LastBellDoorSemanticNodeName[];
}>;

/** Validate node names without coupling the asset contract to Three.Object3D. */
export function validateLastBellDoorSemanticNodes(nodeNames: Iterable<string>): LastBellDoorSemanticValidation {
  const available = new Set(nodeNames);
  const missing = LAST_BELL_DOOR_SEMANTIC_NODE_NAMES.filter((name) => !available.has(name));
  return { valid: missing.length === 0, missing };
}

/** DoorSystem owns progress; the renderer only projects that snapshot locally. */
export function classroomDoorPanelLocalX(openProgress: number): Readonly<{ left: number; right: number }> {
  const progress = Number.isFinite(openProgress) ? Math.min(1, Math.max(0, openProgress)) : 0;
  const outwardTravel = progress * 1.04;
  return { left: -.54 - outwardTravel, right: .54 + outwardTravel };
}

export type LastBellQualityTierId = 'low' | 'medium' | 'desktop';

export type LastBellQualityTier = Readonly<{
  id: LastBellQualityTierId;
  maxDpr: number;
  shadowMapSize: number;
  particleCount: number;
  /** Metadata may provide a matching lightmap tier. Falling back is intentional. */
  lightmapTier: LastBellQualityTierId;
}>;

export const LAST_BELL_QUALITY_TIERS: readonly LastBellQualityTier[] = [
  { id: 'low', maxDpr: 1, shadowMapSize: 512, particleCount: 12, lightmapTier: 'low' },
  { id: 'medium', maxDpr: 1.25, shadowMapSize: 768, particleCount: 20, lightmapTier: 'medium' },
  { id: 'desktop', maxDpr: 1.5, shadowMapSize: 1024, particleCount: 32, lightmapTier: 'desktop' },
] as const;

export function lastBellQualityTierForDpr(dpr: number): LastBellQualityTier {
  const safeDpr = Number.isFinite(dpr) ? Math.max(0, dpr) : 1;
  return LAST_BELL_QUALITY_TIERS.find((tier) => safeDpr <= tier.maxDpr) ?? LAST_BELL_QUALITY_TIERS[2]!;
}

export type LastBellLightmapBinding = Readonly<{
  path: string;
  nodes: readonly string[];
  tier?: LastBellQualityTierId;
  kind: 'baked-light' | 'cycles-ground-receiver-ao';
  /** Three r182 maps glTF TEXCOORD_1 to geometry `uv1` / texture channel 1. */
  uv: 'uv1';
  intensity: number;
}>;

/**
 * The exporter may use either an array or a node-keyed record. Keep this
 * normalizer deliberately tolerant so asset metadata can evolve without a
 * runtime code change, while still refusing unsafe or unsupported paths.
 */
export function normalizeLastBellLightmapBindings(value: unknown): LastBellLightmapBinding[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).map(([node, binding]) => ({ node, binding }))
      : [];

  return entries.flatMap<LastBellLightmapBinding>((entry) => {
    const nodeKey = !Array.isArray(value) && entry && typeof entry === 'object' && 'node' in entry
      ? String((entry as { node: string }).node)
      : undefined;
    const raw = entry && typeof entry === 'object' && 'binding' in entry
      ? (entry as { binding: unknown }).binding
      : entry;
    if (typeof raw === 'string') {
      return raw.endsWith('.ktx2') ? [{
        path: raw,
        nodes: nodeKey ? [nodeKey] : [],
        kind: 'baked-light' as const,
        uv: 'uv1' as const,
        intensity: 1,
      }] : [];
    }
    if (!raw || typeof raw !== 'object') return [];
    const candidate = raw as Record<string, unknown>;
    const path = typeof candidate.path === 'string' ? candidate.path : typeof candidate.url === 'string' ? candidate.url : null;
    if (!path || !path.endsWith('.ktx2')) return [];
    const suppliedNodes = Array.isArray(candidate.nodes)
      ? candidate.nodes.filter((node): node is string => typeof node === 'string')
      : typeof candidate.node === 'string'
        ? [candidate.node]
        : nodeKey ? [nodeKey] : [];
    const tier = candidate.tier === 'low' || candidate.tier === 'medium' || candidate.tier === 'desktop'
      ? candidate.tier
      : undefined;
    const kind = candidate.kind === 'cycles-ground-receiver-ao'
      ? candidate.kind
      : 'baked-light';
    // Some early Blender export notes called the second set "uv2". In r182
    // glTF TEXCOORD_1 is geometry `uv1`, so retain that safe runtime mapping.
    const uv = 'uv1' as const;
    const intensity = typeof candidate.intensity === 'number' && Number.isFinite(candidate.intensity)
      ? candidate.intensity
      : 1;
    return [{ path, nodes: suppliedNodes, tier, kind, uv, intensity }];
  });
}

export function selectLastBellLightmapBindings(
  bindings: readonly LastBellLightmapBinding[],
  quality: LastBellQualityTier,
): LastBellLightmapBinding[] {
  const exactOrUniversal = bindings.filter(
    (binding) => binding.tier === quality.lightmapTier || binding.tier === undefined,
  );
  if (exactOrUniversal.length > 0) return exactOrUniversal;
  // The first reviewed pack ships a single 1K "medium" AO bake. Treat it as
  // the neutral fallback for both constrained and desktop clients until real
  // low/desktop variants exist; silently dropping contact AO on either end
  // makes the same authored room change its spatial read by device class.
  const medium = bindings.filter((binding) => binding.tier === 'medium');
  if (medium.length > 0) return medium;
  const desktop = bindings.filter((binding) => binding.tier === 'desktop');
  return desktop.length > 0 ? desktop : bindings.filter((binding) => binding.tier === 'low');
}
