export const LAST_BELL_PRODUCT_KEYS = [
  'idcard',
  'badge',
  'photo',
  'radio',
  'kit',
  'zipup',
  'archery',
  'postcard',
  'candle',
  'blanket',
] as const;

export type LastBellProductKey = typeof LAST_BELL_PRODUCT_KEYS[number];

export type LastBellProductAsset = Readonly<{
  key: LastBellProductKey;
  model: string;
  thumbnail: string;
  graphicsLayer: string;
  semanticAnchor: string;
  collisionMeters: readonly [number, number, number];
  /**
   * Authored shelf placement, expressed in gameplay-world metres. Product
   * meshes keep a stable local origin while this transform seats each object
   * on its real support instead of floating every SKU at one generic height.
   */
  worldPlacement: Readonly<{
    y: number;
    rotation: readonly [number, number, number];
    scale: number;
    support: 'desk' | 'locker' | 'floor' | 'shelf' | 'board';
  }>;
  lodNodes: readonly ['LOD0_Hero', 'LOD1_Shelf'];
  colliderNode: 'COL_Collectible';
}>;

const PRODUCT_ROOT = '/generated/last-bell/products/' as const;

const productAsset = (
  key: LastBellProductKey,
  semanticAnchor: string,
  collisionMeters: readonly [number, number, number],
  worldPlacement: LastBellProductAsset['worldPlacement'],
): LastBellProductAsset => ({
  key,
  model: `${PRODUCT_ROOT}${key}/model.glb`,
  thumbnail: `${PRODUCT_ROOT}${key}/thumbnail.webp`,
  graphicsLayer: `${PRODUCT_ROOT}${key}/graphic-layer.svg`,
  semanticAnchor,
  collisionMeters,
  worldPlacement,
  lodNodes: ['LOD0_Hero', 'LOD1_Shelf'],
  colliderNode: 'COL_Collectible',
});

/**
 * Renderer-only asset contract. The simulation owns the actual interaction
 * rules; it should reference the stable `semanticAnchor`, never GLB node order.
 */
export const LAST_BELL_PRODUCT_ASSETS: Readonly<Record<LastBellProductKey, LastBellProductAsset>> = {
  idcard: productAsset('idcard', 'collectible.idcard.classroom-desk', [0.72, 0.12, 0.98], {
    y: .81, rotation: [0, -.18, 0], scale: .34, support: 'desk',
  }),
  badge: productAsset('badge', 'collectible.badge.classroom-locker', [0.86, 0.08, 0.32], {
    y: 1.18, rotation: [0, -Math.PI / 2, 0], scale: .34, support: 'locker',
  }),
  photo: productAsset('photo', 'collectible.photo.overturned-desk', [0.78, 0.12, 1.05], {
    y: .08, rotation: [0, .42, -.08], scale: .34, support: 'floor',
  }),
  radio: productAsset('radio', 'collectible.radio.broadcast-desk', [0.56, 0.22, 0.74], {
    y: .79, rotation: [0, .24, 0], scale: .34, support: 'desk',
  }),
  kit: productAsset('kit', 'collectible.kit.infirmary-detour', [0.64, 0.18, 0.9], {
    y: 1.02, rotation: [0, -.36, 0], scale: .34, support: 'shelf',
  }),
  zipup: productAsset('zipup', 'collectible.zipup.athletics-locker-detour', [1.05, 0.24, 1.32], {
    y: 1.22, rotation: [0, -Math.PI / 2, 0], scale: .34, support: 'locker',
  }),
  archery: productAsset('archery', 'collectible.archery.club-board-detour', [0.38, 0.12, 1.18], {
    y: 1.32, rotation: [0, 0, 0], scale: .34, support: 'board',
  }),
  postcard: productAsset('postcard', 'collectible.postcard.corridor-board', [0.86, 0.08, 0.66], {
    y: 1.28, rotation: [0, Math.PI / 2, 0], scale: .34, support: 'board',
  }),
  candle: productAsset('candle', 'collectible.candle.stairwell-shelf', [0.42, 0.42, 0.22], {
    y: 1.04, rotation: [0, -.22, 0], scale: .34, support: 'shelf',
  }),
  blanket: productAsset('blanket', 'collectible.blanket.rooftop-emergency-box', [0.92, 0.26, 0.72], {
    y: .14, rotation: [0, .28, 0], scale: .34, support: 'floor',
  }),
};
