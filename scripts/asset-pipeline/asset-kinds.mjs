export const ASSET_KIND_CAPABILITIES = Object.freeze({
  sprite: Object.freeze({ atlas: true, trim: true }),
  tileset: Object.freeze({ atlas: false, trim: false }),
  background: Object.freeze({ atlas: false, trim: false }),
  boss: Object.freeze({ atlas: true, trim: true }),
  cutin: Object.freeze({ atlas: false, trim: true }),
  ui: Object.freeze({ atlas: true, trim: true }),
});

export function isSupportedAssetKind(kind) {
  return Object.hasOwn(ASSET_KIND_CAPABILITIES, kind);
}

export function assetKindSupports(kind, capability) {
  return ASSET_KIND_CAPABILITIES[kind]?.[capability] === true;
}
