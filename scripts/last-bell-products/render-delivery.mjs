#!/usr/bin/env node
/** Render a catalog thumbnail from the final KTX2 delivery GLB in Chromium. */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, extname, relative, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const [modelArg, outputArg, cameraPreset = 'catalog-three-quarter', placementArg = 'floor', distanceArg = '2.2'] = process.argv.slice(2);
if (!modelArg || !outputArg) throw new Error('usage: render-delivery.mjs <delivery.glb> <thumbnail.png> [catalog-three-quarter|full-front|full-three-quarter|full-back|closeup-face|gameplay-flashlight|gameplay-discovery] [desk|floor|shelf|locker|board] [distance-metres]');
if (!['catalog-three-quarter', 'full-front', 'full-three-quarter', 'full-back', 'closeup-face', 'gameplay-flashlight', 'gameplay-discovery'].includes(cameraPreset)) {
  throw new Error(`unknown delivery camera preset: ${cameraPreset}`);
}
if (!['desk', 'floor', 'shelf', 'locker', 'board'].includes(placementArg)) throw new Error(`unknown discovery placement: ${placementArg}`);
const requestedDistance = Number(distanceArg);
if (!Number.isFinite(requestedDistance) || requestedDistance < 1.5 || requestedDistance > 3.0) throw new Error('discovery distance must be between 1.5 and 3.0 metres');
const root = resolve(import.meta.dirname, '../..');
const model = resolve(modelArg);
const output = resolve(outputArg);
const chrome = process.env.LAST_BELL_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const contentType = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const REVIEW_WIDTH = 768;
const REVIEW_HEIGHT = 768;

const html = `<!doctype html><html><body style="margin:0;background:#020305"><script>window.addEventListener('error', (event) => { window.__lastBellDeliveryRender = 'error:' + event.message; }); window.addEventListener('unhandledrejection', (event) => { window.__lastBellDeliveryRender = 'error:' + event.reason; });</script><script type="importmap">{"imports":{"three":"/modules/three/build/three.module.js"}}</script><script type="module">
import * as THREE from '/modules/three/build/three.module.js';
import { GLTFLoader } from '/modules/three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from '/modules/three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from '/modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${REVIEW_WIDTH}, ${REVIEW_HEIGHT}); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2; renderer.shadowMap.enabled = true;
const flashlightReview = ${JSON.stringify(cameraPreset)} === 'gameplay-flashlight';
const discoveryReview = ${JSON.stringify(cameraPreset)} === 'gameplay-discovery';
const discoveryPlacement = ${JSON.stringify(placementArg)};
const discoveryDistance = ${JSON.stringify(requestedDistance)};
renderer.setClearColor((flashlightReview || discoveryReview) ? 0x020407 : 0x10161a); document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, ${REVIEW_WIDTH} / ${REVIEW_HEIGHT}, .01, 100);
scene.add(new THREE.HemisphereLight(0xb5e4ec, 0x080b0f, (flashlightReview || discoveryReview) ? .12 : 2.6));
const key = new THREE.DirectionalLight(0xe4f6ff, (flashlightReview || discoveryReview) ? .05 : 4.8); key.position.set(3.2, -4, 4.3); key.castShadow = true; scene.add(key);
const fill = new THREE.DirectionalLight(0x50b7c6, (flashlightReview || discoveryReview) ? .015 : 1.65); fill.position.set(-3, -1.6, 2.4); scene.add(fill);
const rim = new THREE.DirectionalLight(0xe7a663, (flashlightReview || discoveryReview) ? .0 : 1.25); rim.position.set(-1.6, 2.8, 3.5); scene.add(rim);
const ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
loader.load('/model.glb', (gltf) => {
  const root = gltf.scene;
  root.traverse((object) => {
    if (/^(COL_|LOD1_)/.test(object.name)) object.visible = false;
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  scene.add(root);
  let box = new THREE.Box3().setFromObject(root); let center = box.getCenter(new THREE.Vector3()); let size = box.getSize(new THREE.Vector3());
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: (flashlightReview || discoveryReview) ? 0x030609 : 0x172126, roughness: .86, metalness: .05 }));
  // glTF is Y-up: keep the review cyclorama beneath the delivery model, not
  // through its vertical midpoint. Using min.z here would occlude front-facing
  // card, radio, and textile panels after Blender's Y-up export conversion.
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, discoveryReview ? -.018 : box.min.y - .018, center.z);
  floor.receiveShadow = true; scene.add(floor);
  if (discoveryReview) {
    // Normalise review-only world scale to the support category. The exact
    // GLB is still imported intact; this simply prevents a hero thumbnail
    // lanyard from becoming a two-metre map prop and makes a fixed metric
    // camera distance meaningful across all ten pickups.
    const desiredExtent = { desk: .92, floor: 1.02, shelf: .78, locker: 1.38, board: .92 }[discoveryPlacement];
    const rawExtent = Math.max(size.x, size.y, size.z);
    root.scale.setScalar(desiredExtent / rawExtent);
    box = new THREE.Box3().setFromObject(root); center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
    const environment = new THREE.MeshStandardMaterial({ color: 0x455257, roughness: .91, metalness: .08 });
    const paintedMetal = new THREE.MeshStandardMaterial({ color: 0x3a5962, roughness: .62, metalness: .48 });
    const addBlock = (position, dimensions, material = environment) => {
      const prop = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
      prop.position.set(...position); prop.castShadow = true; prop.receiveShadow = true; scene.add(prop);
    };
    // Recentre the imported delivery object, then set its base at a semantic
    // gameplay surface. These are intentionally contextual support props, not
    // a second product render or a substitute geometry package.
    root.position.x -= center.x;
    root.position.z -= center.z;
    const supportHeight = { desk: .76, floor: 0, shelf: 1.08, locker: .66, board: .94 }[discoveryPlacement];
    root.position.y += supportHeight - box.min.y;
    if (discoveryPlacement === 'desk') {
      addBlock(([-.10, .70, 0]), ([2.10, .12, 1.24]));
      addBlock(([-.86, .34, -.38]), ([.12, .72, .12]), paintedMetal);
      addBlock(([.66, .34, .36]), ([.12, .72, .12]), paintedMetal);
      addBlock(([.84, .83, -.25]), ([.28, .18, .32]), paintedMetal);
    } else if (discoveryPlacement === 'floor') {
      addBlock(([-.82, .18, -.34]), ([.60, .34, .48]), paintedMetal);
      addBlock(([.78, .05, .32]), ([.55, .10, .38]));
    } else if (discoveryPlacement === 'shelf') {
      addBlock(([0, 1.00, -.34]), ([2.05, .08, .46]), paintedMetal);
      addBlock(([0, 1.62, -.55]), ([2.05, 1.24, .10]), environment);
      addBlock(([-.91, 1.22, -.34]), ([.10, .52, .50]), paintedMetal);
    } else if (discoveryPlacement === 'locker') {
      addBlock(([0, .58, -.35]), ([1.82, 1.25, .10]), paintedMetal);
      addBlock(([0, .64, 0]), ([1.70, .08, .52]), paintedMetal);
      addBlock(([-.78, .72, -.08]), ([.10, 1.30, .50]), paintedMetal);
    } else if (discoveryPlacement === 'board') {
      addBlock(([0, .96, -.22]), ([2.05, 1.38, .10]), environment);
      addBlock(([0, 1.63, -.13]), ([2.18, .08, .16]), paintedMetal);
      addBlock(([-.96, .96, -.13]), ([.08, 1.40, .16]), paintedMetal);
      addBlock(([.96, .96, -.13]), ([.08, 1.40, .16]), paintedMetal);
    }
    box = new THREE.Box3().setFromObject(root); center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
  }
  const distance = discoveryReview ? discoveryDistance : Math.max(size.x, size.y, size.z) * 1.35 + .35;
  const presets = {
    'catalog-three-quarter': { offset: new THREE.Vector3(distance * .45, distance * .35, distance), target: center },
    'full-front': { offset: new THREE.Vector3(0, distance * .08, distance), target: center },
    'full-three-quarter': { offset: new THREE.Vector3(distance * .45, distance * .24, distance), target: center },
    'full-back': { offset: new THREE.Vector3(0, distance * .08, -distance), target: center },
    'closeup-face': { offset: new THREE.Vector3(distance * .16, distance * .06, distance * .34), target: center.clone().add(new THREE.Vector3(0, size.y * .24, 0)) },
    'gameplay-flashlight': { offset: new THREE.Vector3(distance * .30, distance * .25, distance), target: center },
    'gameplay-discovery': { offset: new THREE.Vector3(distance * .38, distance * .26, distance), target: center.clone().add(new THREE.Vector3(0, size.y * .08, 0)) },
  };
  const preset = presets[${JSON.stringify(cameraPreset)}];
  camera.position.copy(center).add(preset.offset); camera.lookAt(preset.target);
  if (flashlightReview || discoveryReview) {
    const flashlight = new THREE.SpotLight(0xd5efff, 22, distance * 3.2, .38, .58, 1.4);
    flashlight.position.copy(camera.position);
    flashlight.castShadow = true;
    flashlight.target.position.copy(preset.target);
    scene.add(flashlight, flashlight.target);
  }
  renderer.render(scene, camera); window.__lastBellDeliveryRender = 'ready';
}, (event) => { window.__lastBellDeliveryProgress = event.loaded; }, (error) => { window.__lastBellDeliveryRender = 'error:' + error; });
</script></body></html>`;

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  try {
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return;
    }
    const disk = path === '/model.glb'
      ? model
      : path.startsWith('/basis/')
        ? resolve(root, 'public/generated/last-bell/3d/basis', basename(path))
        : path.startsWith('/modules/')
          ? resolve(root, 'node_modules', relative('/modules', path))
          : null;
    if (!disk || !disk.startsWith(root)) throw new Error('unknown local asset');
    response.writeHead(200, { 'content-type': contentType[extname(disk)] ?? 'application/octet-stream', 'cross-origin-resource-policy': 'cross-origin' });
    response.end(await readFile(disk));
  } catch {
    response.writeHead(404); response.end('not found');
  }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const reserveDebugPort = createServer();
await new Promise((resolveListen) => reserveDebugPort.listen(0, '127.0.0.1', resolveListen));
const debugPort = reserveDebugPort.address().port;
await new Promise((close) => reserveDebugPort.close(close));

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chrome debug endpoint returned ${response.status}`);
  return response.json();
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let nextId = 0;
  const requests = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveCall, rejectCall) => requests.set(id, { resolve: resolveCall, reject: rejectCall }));
    },
    close() { socket.close(); },
  };
}

const profile = await mkdtemp(join(tmpdir(), 'last-bell-delivery-render-'));
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=768,768',
  `http://127.0.0.1:${port}/`,
], { stdio: 'ignore' });
try {
  const deadline = Date.now() + 20000;
  let tab;
  while (Date.now() < deadline && !tab) {
    try { tab = (await requestJson(`http://127.0.0.1:${debugPort}/json/list`)).find((entry) => entry.type === 'page'); } catch {}
    if (!tab) await wait(100);
  }
  if (!tab?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a render tab');
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    let result = '';
    while (Date.now() < deadline) {
      result = (await cdp.call('Runtime.evaluate', { expression: 'window.__lastBellDeliveryRender || ""', returnByValue: true })).result.value;
      if (result === 'ready') break;
      if (String(result).startsWith('error:')) throw new Error(`Delivery GLB renderer failed: ${result}`);
      await wait(100);
    }
    if (result !== 'ready') throw new Error('Delivery GLB renderer timed out before KTX2 was ready');
    const screenshot = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: REVIEW_WIDTH, height: REVIEW_HEIGHT, scale: 1 },
    });
    await writeFile(output, Buffer.from(screenshot.data, 'base64'));
  } finally {
    cdp.close();
  }
} finally {
  child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
  await new Promise((close) => server.close(close));
}
