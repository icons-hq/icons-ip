#!/usr/bin/env node
/**
 * Fetch the small, approved CC0 material subset from Poly Haven's official
 * API. Source downloads and their provenance are deliberately kept under
 * ignored outputs/, not mixed with shipped drama/IP artwork.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const targetDir = resolve(process.argv[2] ?? 'outputs/last-bell-3d/raw/polyhaven-pbr');
const assets = [
  { id: 'worn_tile_floor', material: 'Dirty_Floor_Tile', size: 512, author: 'Dimitrios Savva', expected: { Diffuse: 'ebde65c2e23e9c2d4fb718392b4f4f6a', nor_gl: '609bc9454af1bb454acdd1176fa6f14a', arm: 'c82ea1d8f25f5f3e882af1e69b3f1e77' } },
  { id: 'tarred_gravel', material: 'Tarred_Gravel', size: 512, author: 'Dimitrios Savva', expected: { Diffuse: 'd7b12ce931d0d7b7ecafffbf0a2d0574', nor_gl: '4c2c48978cef51d2fd336f15391d1ead', arm: '6616be30a8a54e63a17f654c19be2fb0' } },
  { id: 'worn_plaster_wall', material: 'Charred_Plaster', size: 512, author: 'Dimitrios Savva', expected: { Diffuse: '31aab3a5bf3859361cd423e15b9735bc', nor_gl: '2e1cb2651163105acda653e9c9b9b7b8', arm: 'c05a77f6150c8f25400ea124a5871179' } },
  { id: 'green_metal_rust', material: 'Smoked_Aluminium', size: 512, author: 'Rob Tuytel', expected: { Diffuse: 'f69d8c507961f0629019652162090917', nor_gl: 'a6cefc436aa41f73f15347dcf7a791d0', arm: 'f7474f11a76b3747265873c325ecbb88' } },
  { id: 'fine_grained_wood', material: 'Worn_Wood', size: 512, author: 'Rob Tuytel', expected: { Diffuse: '3db9decdde678e087e67ff99d30c0a73', nor_gl: 'a9e33e87ea5c32945fc30553767b7046', arm: 'e0d2eb48c2eb9c36af2786c8a10269ff' } },
  { id: 'red_brick_03', material: 'Exposed_Brick', size: 512, author: 'Rob Tuytel', expected: { Diffuse: 'd157c6d6dd774762b4269927a87fe9b5', nor_gl: 'e89ce432d9160edb7c902f901756865f', arm: '1b5472dd06888c7cf7db63e692e03978' } },
  { id: 'concrete_debris', material: 'Concrete_Debris', size: 512, author: 'Amal Kumar', expected: { Diffuse: 'fcad77ded806a6eda1921457cf7e2abe', nor_gl: '0fabaf2cb4a0c68528635ac1443915e2', arm: 'b44c54a9b2f0f7e38436a96123c32c64' } },
  { id: 'broken_brick_wall', material: 'Broken_BrickWall', size: 512, author: 'Amal Kumar', expected: { Diffuse: '5f6a252fe6353183ca86f7314cb77cab', nor_gl: '4da30f0f7ba1a5bf9fcb4602638fab11', arm: '02e60c0addb6a0fd216838afb19d9527' } },
  { id: 'cotton_jersey', material: 'Cotton_Jersey', size: 512, author: 'colormass', expected: { Diffuse: 'd2f4493fdd48634b50d40f810ce9deb7', nor_gl: '2dcc9dda3b726477f607c808e52f1833', arm: 'f568748c335892e00b767565a3d5b6ae' } },
];
// Two hero props only: high-fidelity foreground silhouettes, while all
// repeated desks/chairs stay procedural and instanced. Every upstream MD5 is
// pinned so an API replacement cannot silently change a shipped asset.
const models = [
  {
    id: 'SchoolDesk_01', author: 'Ethan Place', file: { path: 'SchoolDesk_01_1k.gltf', md5: 'f327b010a117ab6af3dec7538cdf23ee' },
    include: {
      'textures/SchoolDesk_01_diff_1k.jpg': 'f6be3e2428c88c86c1a328798b592e5e',
      'textures/SchoolDesk_01_nor_gl_1k.jpg': 'b79a0c557ecea2c7d79433ac70547a43',
      'textures/SchoolDesk_01_arm_1k.jpg': '34b3a4444d2a2b0266e3bf3a6dfc9b2c',
      'SchoolDesk_01.bin': 'af08b1337236d6b951ea9805032abd32',
    },
  },
  {
    id: 'SchoolChair_01', author: 'Ethan Place', file: { path: 'SchoolChair_01_1k.gltf', md5: 'dea922d55d029fb99085b50196d1eec0' },
    include: {
      'textures/SchoolChair_01_diff_1k.jpg': '2d5c9c77d97ba2edd5084a9d72b5dd63',
      'textures/SchoolChair_01_nor_gl_1k.jpg': '223a0e5d115fb86cf1ae675fe73dc04a',
      'textures/SchoolChair_01_arm_1k.jpg': '559daea007902aae5b5d5623a34b3a13',
      'SchoolChair_01.bin': 'd1f13f71f9f9979cde18c798e25dd9d3',
    },
  },
  {
    id: 'modular_airduct_circular_01', author: 'Riley Queen', file: { path: 'modular_airduct_circular_01_1k.gltf', md5: 'b4612872c97a576c1f2a3351c68d3514' },
    include: {
      'textures/modular_airduct_circular_01_diff_1k.jpg': '832ee18e84ea80eab47b042e3440336a',
      'textures/modular_airduct_circular_01_nor_gl_1k.jpg': 'b9c78219a302fece6630135ef581bcd6',
      'textures/modular_airduct_circular_01_arm_1k.jpg': 'fcf6c5d505bd8291412bf6f607980ce4',
      'modular_airduct_circular_01.bin': '89ddfff523c9edf478aa7441b69d1491',
    },
  },
];
const headers = { 'User-Agent': 'LastBellAssetPipeline/1.0 (CC0 runtime PBR build)' };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const md5 = (value) => createHash('md5').update(value).digest('hex');

function findFile(files, map) {
  const candidates = [map, map.toLowerCase(), map.toUpperCase()];
  for (const key of candidates) {
    const resolution = files[key]?.['1k'];
    const record = resolution?.jpg ?? resolution?.png;
    if (record?.url && record?.md5) return record;
  }
  throw new Error(`Poly Haven API response is missing 1k ${map}`);
}

await mkdir(targetDir, { recursive: true });
const provenance = {
  schema: 1,
  license: 'CC0-1.0',
  provider: 'Poly Haven official API',
  api: 'https://api.polyhaven.com/files/{asset-id}',
  no_drama_or_netflix_source_pixels: true,
  assets: [],
  models: [],
};

for (const asset of assets) {
  const apiUrl = `https://api.polyhaven.com/files/${asset.id}`;
  const infoUrl = `https://api.polyhaven.com/info/${asset.id}`;
  const response = await fetch(apiUrl, { headers });
  if (!response.ok) throw new Error(`${asset.id}: API ${response.status}`);
  const files = await response.json();
  const infoResponse = await fetch(infoUrl, { headers });
  if (!infoResponse.ok) throw new Error(`${asset.id}: info API ${infoResponse.status}`);
  const info = await infoResponse.json();
  if (!Object.hasOwn(info.authors ?? {}, asset.author)) throw new Error(`${asset.id}: expected author ${asset.author} not found in info API`);
  const record = { id: asset.id, material: asset.material, resolution: `${asset.size}px`, license: 'CC0-1.0', author: asset.author, asset_page_url: `https://polyhaven.com/a/${asset.id}`, api_url: apiUrl, info_api_url: infoUrl, files_hash: info.files_hash, maps: {} };
  for (const [map, output] of [['Diffuse', 'basecolor'], ['nor_gl', 'normal'], ['arm', 'orm']]) {
    const upstream = findFile(files, map);
    if (upstream.md5 !== asset.expected[map]) throw new Error(`${asset.id}/${map}: upstream API MD5 drift (expected ${asset.expected[map]}, received ${upstream.md5})`);
    const sourceResponse = await fetch(upstream.url, { headers });
    if (!sourceResponse.ok) throw new Error(`${asset.id}/${map}: download ${sourceResponse.status}`);
    const source = Buffer.from(await sourceResponse.arrayBuffer());
    if (md5(source) !== upstream.md5) throw new Error(`${asset.id}/${map}: MD5 mismatch`);
    const filename = `${asset.material.toLowerCase().replaceAll('_', '-')}-${output}.png`;
    const converted = await sharp(source)
      .resize(asset.size, asset.size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(join(targetDir, filename), converted);
    record.maps[output] = {
      source_url: upstream.url,
      source_md5: upstream.md5,
      source_bytes: source.byteLength,
      vendored_file: filename,
      vendored_sha256: sha256(converted),
      vendored_bytes: converted.byteLength,
    };
  }
  provenance.assets.push(record);
}

async function downloadPinned(record, expectedMd5, destination) {
  if (record.md5 !== expectedMd5) throw new Error(`${destination}: upstream API MD5 drift (expected ${expectedMd5}, received ${record.md5})`);
  const response = await fetch(record.url, { headers });
  if (!response.ok) throw new Error(`${destination}: download ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  if (md5(source) !== expectedMd5) throw new Error(`${destination}: MD5 mismatch`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, source);
  return { source_url: record.url, source_md5: expectedMd5, source_bytes: source.byteLength, vendored_sha256: sha256(source), vendored_bytes: source.byteLength };
}

for (const model of models) {
  const apiUrl = `https://api.polyhaven.com/files/${model.id}`;
  const infoUrl = `https://api.polyhaven.com/info/${model.id}`;
  const [filesResponse, infoResponse] = await Promise.all([fetch(apiUrl, { headers }), fetch(infoUrl, { headers })]);
  if (!filesResponse.ok || !infoResponse.ok) throw new Error(`${model.id}: API ${filesResponse.status}/${infoResponse.status}`);
  const files = await filesResponse.json();
  const info = await infoResponse.json();
  if (!Object.hasOwn(info.authors ?? {}, model.author)) throw new Error(`${model.id}: expected author ${model.author} not found in info API`);
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf?.url) throw new Error(`${model.id}: missing 1k glTF`);
  const modelDir = join(targetDir, 'models', model.id);
  const downloaded = {};
  downloaded[model.file.path] = await downloadPinned(gltf, model.file.md5, join(modelDir, model.file.path));
  for (const [relativePath, expectedMd5] of Object.entries(model.include)) {
    const include = gltf.include?.[relativePath];
    if (!include?.url) throw new Error(`${model.id}: missing include ${relativePath}`);
    downloaded[relativePath] = await downloadPinned(include, expectedMd5, join(modelDir, relativePath));
  }
  provenance.models.push({
    id: model.id, author: model.author, license: 'CC0-1.0', resolution: '1k', asset_page_url: `https://polyhaven.com/a/${model.id}`,
    api_url: apiUrl, info_api_url: infoUrl, files_hash: info.files_hash, files: downloaded,
  });
}
await writeFile(join(targetDir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance, null, 2));
