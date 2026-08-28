import {
  regridFrameSheet,
  restoreMagentaTransparency,
} from './image-processing.mjs';

const TRANSFORMS = Object.freeze({
  'magenta-matte-to-alpha': async ({ candidatePath }) => (
    restoreMagentaTransparency(candidatePath)
  ),
  'magenta-matte-to-alpha-and-regrid': async ({ candidatePath, asset }) => ({
    matte: await restoreMagentaTransparency(candidatePath),
    regrid: await regridFrameSheet(candidatePath, asset),
  }),
});

export function isSupportedTechnicalTransform(name) {
  return Object.hasOwn(TRANSFORMS, name);
}

export async function applyTechnicalTransform(name, context) {
  const transform = TRANSFORMS[name];
  if (!transform) throw new Error(`Unsupported technical transform: ${name}`);
  return transform(context);
}
