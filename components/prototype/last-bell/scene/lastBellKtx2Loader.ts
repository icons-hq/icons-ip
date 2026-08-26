import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { LAST_BELL_ASSETS } from '@/lib/prototypes/last-bell/assets';

let renderer: THREE.WebGLRenderer | null = null;
let loader: KTX2Loader | null = null;

/**
 * One renderer owns one Basis transcoder pool. Opening, streamed route,
 * character and product GLBs all share it so Three never creates competing
 * KTX2 worker pools during the portal hand-off.
 */
export function getLastBellKtx2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  if (renderer === gl && loader) return loader;
  loader?.dispose();
  renderer = gl;
  loader = new KTX2Loader()
    .setTranscoderPath(LAST_BELL_ASSETS.environment3d.basisTranscoder)
    .setWorkerLimit(2)
    .detectSupport(gl);
  return loader;
}
