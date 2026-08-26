#!/usr/bin/env node
/** Render a delivery route GLB from an authored player-height review camera. */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, extname, relative, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { validateLastBellReviewFrame } from './review-frame.mjs';

const [modelArg, outputArg, zone] = process.argv.slice(2);
const REVIEW_ZONES = ['corridor', 'infirmary', 'broadcast', 'utility', 'stairwell', 'rooftop'];
if (!modelArg || !outputArg || !REVIEW_ZONES.includes(zone)) {
  throw new Error(`usage: render-review.mjs <delivery.glb> <review.png> <${REVIEW_ZONES.join('|')}>`);
}

const root = resolve(import.meta.dirname, '../..');
const model = resolve(modelArg);
const output = resolve(outputArg);
const chrome = process.env.LAST_BELL_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const contentType = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const html = `<!doctype html><body style="margin:0;background:#020508"><script type="importmap">{"imports":{"three":"/modules/three/build/three.module.js"}}</script><script type="module">
import * as THREE from '/modules/three/build/three.module.js';
import { GLTFLoader } from '/modules/three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from '/modules/three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from '/modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const REVIEW_WIDTH = 1280, REVIEW_HEIGHT = 720;
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setSize(REVIEW_WIDTH, REVIEW_HEIGHT); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.setClearColor(0x071a23); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x061117, 12, 64);
// Same cold moon/failed-fluorescent baseline as the runtime's opening: enough
// fill to read PBR roughness, but no unmotivated broad daylight substitute.
scene.add(new THREE.HemisphereLight(0x729ca5, 0x07090c, 1.78));
// Runtime-equivalent exposure: restrained cyan fill plus a centred player
// beam. This intentionally avoids a broad review-only daylight wash.
const key = new THREE.DirectionalLight(0xa8d6d8, 2.60); key.position.set(-2, 5, -6); scene.add(key);
key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = .2; key.shadow.camera.far = 34;
const rim = new THREE.PointLight(0x46a7b1, 15, 16, 2); rim.position.set(0, 2.9, 0); scene.add(rim);
// Strict stage review uses the next player-camera target: 1.65m eye height
// and a 62-degree field of view. This keeps the headhouse/fire composition
// legible without a non-playable cinematic lens.
const camera = new THREE.PerspectiveCamera(62, REVIEW_WIDTH / REVIEW_HEIGHT, .08, 100);
// Match the runtime's authored hand-light profile. A naked review renderer
// made a loaded route look like a flat black/grey frame even when its PBR
// surfaces were present; this is not an extra baked route light.
const torchTarget = new THREE.Object3D(); scene.add(torchTarget);
const torch = new THREE.SpotLight(0xd8ece5, 78, 16, THREE.MathUtils.degToRad(19.5), .86, 1.75); torch.target = torchTarget; scene.add(torch);
const torchFill = new THREE.SpotLight(0x62aaa7, 16, 8.5, THREE.MathUtils.degToRad(68), .94, 2); torchFill.target = torchTarget; scene.add(torchFill);
const loader = new GLTFLoader().setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer)).setMeshoptDecoder(MeshoptDecoder);
loader.load('/model.glb', (gltf) => {
 const root = gltf.scene; root.traverse((object) => { if (/^(COL_|LOD1_)/.test(object.name)) object.visible = false; if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } }); scene.add(root);
 // Review framing must derive from the playable slab, not the global scene
 // AABB. A real distant night dome intentionally makes the route bounds very
 // large; using that backdrop for the camera would place the reviewer outside
 // the roof and turn valid geometry into a near-black frame.
 const playable = ${JSON.stringify(zone)} === 'rooftop' ? root.getObjectByName('RooftopSlab') : root;
 const box = new THREE.Box3().setFromObject(playable ?? root), min = box.min, max = box.max, center = box.getCenter(new THREE.Vector3());
 const profiles = {
  corridor: { position: new THREE.Vector3(center.x, min.y + 1.62, min.z + 1.35), target: new THREE.Vector3(center.x, min.y + 1.56, Math.min(max.z - .8, min.z + 12.5)) },
  infirmary: { position: new THREE.Vector3(min.x + .85, min.y + 1.62, min.z + 2.0), target: new THREE.Vector3(max.x - 1.0, min.y + 1.48, max.z - 2.0) },
  broadcast: { position: new THREE.Vector3(max.x - .85, min.y + 1.62, min.z + 2.0), target: new THREE.Vector3(min.x + 1.0, min.y + 1.48, max.z - 2.0) },
  utility: { position: new THREE.Vector3(center.x, min.y + 1.62, min.z + 1.0), target: new THREE.Vector3(center.x, min.y + 1.5, max.z - .7) },
  stairwell: { position: new THREE.Vector3(center.x, min.y + 1.62, min.z + 1.25), target: new THREE.Vector3(center.x, min.y + 3.0, max.z - 1.1) },
  // A reachable point 5.25m beyond the rooftop doorway, still in the clear
  // central lane at player eye height.  This deliberately evaluates the
  // 0–12m scan-rubble band and then the runtime CampfireLight seam, rather
  // than using a cinematic or unreachable camera to hide either contract.
  rooftop: { position: new THREE.Vector3(-1.05, min.y + 1.65, min.z + 5.25), target: new THREE.Vector3(2.8, min.y + 1.1, min.z + 16.7) },
 };
 const profile = profiles[${JSON.stringify(zone)}]; camera.position.copy(profile.position); camera.lookAt(profile.target);
 if (${JSON.stringify(zone)} === 'rooftop') {
   // This is the runtime-aligned warm key used only to make the real authored
   // logs/hearth legible in review; it is neither baked into nor a substitute
   // for route geometry, particles, or flame billboards.
   const fireKey = new THREE.PointLight(0xff7438, 62, 16, 2);
   // The runtime particle light is intentionally unshadowed.  A low-map
   // point-light shadow here samples the roof membrane at grazing angles and
   // produces radial orange/black acne that does not exist in the runtime
   // light seam; nearby authored hearth geometry still receives the route's
   // directional contact shadows.
   fireKey.position.set(2.8, min.y + 1.1, min.z + 16.7); fireKey.castShadow = false; scene.add(fireKey);
   // The review draws the runtime seam through its warm practical only. A
   // synthetic point-cloud rendered as an orange grid at player height and
   // hid the real small logs/hearth; moving flame and smoke remain runtime
   // owned and are intentionally absent from both private GLB review frames.
 }
 torch.position.copy(camera.position); torchFill.position.copy(camera.position); torchTarget.position.copy(profile.target); torchTarget.updateMatrixWorld();
 renderer.render(scene, camera); window.__lastBellRouteReview = 'ready';
}, undefined, (error) => { window.__lastBellRouteReview = 'error:' + error; });
</script>`;

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  try {
    if (path === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
    const disk = path === '/model.glb' ? model : path.startsWith('/basis/') ? resolve(root, 'public/generated/last-bell/3d/basis', basename(path)) : path.startsWith('/modules/') ? resolve(root, 'node_modules', relative('/modules', path)) : null;
    if (!disk || !disk.startsWith(root)) throw new Error('unknown local asset');
    response.writeHead(200, { 'content-type': contentType[extname(disk)] ?? 'application/octet-stream', 'cross-origin-resource-policy': 'cross-origin' }); response.end(await readFile(disk));
  } catch { response.writeHead(404); response.end('not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const debugReservation = createServer();
await new Promise((done) => debugReservation.listen(0, '127.0.0.1', done));
const debugPort = debugReservation.address().port;
await new Promise((done) => debugReservation.close(done));
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const requestJson = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Chrome debug endpoint returned ${response.status}`); return response.json(); };
const connect = async (wsUrl) => {
  const socket = new WebSocket(wsUrl); await new Promise((done, reject) => { socket.addEventListener('open', done, { once:true }); socket.addEventListener('error', reject, { once:true }); });
  let nextId = 0; const requests = new Map(); socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data); const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return { call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveCall, rejectCall) => requests.set(id, { resolve: resolveCall, reject: rejectCall })); }, close() { socket.close(); } };
};
const profile = await mkdtemp(join(tmpdir(), 'last-bell-route-review-'));
const child = spawn(chrome, ['--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1280,720', `http://127.0.0.1:${port}/`], { stdio:'ignore' });
try {
  const deadline = Date.now() + 20000; let tab;
  while (Date.now() < deadline && !tab) { try { tab = (await requestJson(`http://127.0.0.1:${debugPort}/json/list`)).find((entry) => entry.type === 'page'); } catch {} if (!tab) await wait(100); }
  if (!tab?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a route review tab');
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    let result = ''; while (Date.now() < deadline) { result = (await cdp.call('Runtime.evaluate', { expression:'window.__lastBellRouteReview || ""', returnByValue:true })).result.value; if (result === 'ready') break; if (String(result).startsWith('error:')) throw new Error(`Route review renderer failed: ${result}`); await wait(100); }
    if (result !== 'ready') throw new Error('Route review renderer timed out before KTX2 was ready');
    // Chrome's headless outer window is shorter than its requested viewport on
    // some macOS builds. Capture the authored canvas explicitly so the locked
    // 1280x720 camera contract is real rather than only present in the name.
    const screenshot = await cdp.call('Page.captureScreenshot', {
      format:'png',
      captureBeyondViewport:true,
      clip:{ x:0, y:0, width:1280, height:720, scale:1 },
    }); await writeFile(output, Buffer.from(screenshot.data, 'base64'));
  } finally { cdp.close(); }
} finally { child.kill('SIGKILL'); await rm(profile, { recursive:true, force:true }); await new Promise((done) => server.close(done)); }
console.log(JSON.stringify({ validation:'pass', zone, output, ...(await validateLastBellReviewFrame(output)) }, null, 2));
