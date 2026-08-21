import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = resolve(ROOT, 'docs/ip/all-of-us-are-dead-2/asset-manifest.json');
const SOURCE_COMMIT = 'd63c7f0c4c5851c9722afdd895c87b72a7217c2d';
const SOURCE_ROOT = '50_apps/plan-viewer/public/ip-popups/aouad';
const SAMPLE_URL = 'https://icons-plan.vercel.app/sample/aouad';

function localPath(assetPath) {
  return resolve(ROOT, assetPath.startsWith('/generated/') ? `public${assetPath}` : assetPath);
}

function integrity(assetPath) {
  const filePath = localPath(assetPath);
  const bytes = readFileSync(filePath);
  if (!statSync(filePath).isFile()) throw new Error(`Not a file: ${assetPath}`);
  return {
    byte_size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function imageAsset(definition) {
  return {
    ...definition,
    dimensions: { width: definition.width, height: definition.height },
    width: undefined,
    height: undefined,
    ...integrity(definition.path),
  };
}

function audioAsset(definition) {
  return {
    ...definition,
    dimensions: null,
    codec: 'pcm_s16le',
    sample_rate_hz: 48000,
    channels: 1,
    ...integrity(definition.path),
  };
}

const official = [
  ['key-armed-group.jpg', 1280, 720, 'campaign hero alternate and action-group archive'],
  ['key-title-art.jpg', 1280, 1920, 'campaign title-art archive and poster crop'],
  ['key-yearbook-blood.jpg', 1280, 720, 'opening yearbook detail and classroom archive'],
  ['logo-title.png', 500, 533, 'official title mark in the campaign header'],
  ['poster-action-group.jpg', 500, 741, 'collection poster and action-zone supporting image'],
  ['poster-archery.jpg', 500, 741, 'collection poster and rooftop supporting image'],
  ['poster-duo-dark.jpg', 500, 750, 'collection poster and IF-theater supporting image'],
  ['poster-main-kr.jpg', 500, 741, 'campaign poster archive'],
  ['poster-school-aerial.jpg', 500, 741, 'school-map archive and route reference'],
  ['poster-villain.jpg', 500, 741, 'collection poster and threat archive'],
  ['promo-cast-profile.jpg', 1280, 720, 'campaign news and cast archive'],
  ['still-armed-group-walk.jpg', 1280, 720, 'collection action still'],
  ['still-barricade.jpg', 1280, 720, 'classroom zone hero'],
  ['still-bonfire.jpg', 1280, 720, 'rooftop memory archive without synthetic community counts'],
  ['still-classroom-outbreak.jpg', 1280, 720, 'outbreak transition and classroom archive'],
  ['still-corridor-run.jpg', 1280, 720, 'IF-theater and pursuit archive'],
  ['still-gym-group.jpg', 1280, 720, 'cafeteria and group-survival archive'],
  ['still-infirmary.jpg', 1280, 720, 'infection-record supporting image'],
  ['still-jeolbi-closeup.jpg', 1280, 720, 'infection-record close-up archive'],
  ['still-library.jpg', 1280, 720, 'classroom record and library archive'],
  ['still-music-room.jpg', 1279, 719, 'broadcast and music-room archive'],
  ['still-schoolyard.jpg', 1280, 720, 'schoolyard and survival-arcade archive'],
  ['still-window-pair.jpg', 1280, 720, 'student-record and relationship archive'],
  ['still-zombie-rush.jpg', 1279, 720, 'survival-arcade threat archive'],
].map(([name, width, height, usage]) => imageAsset({
  id: `campaign-official-${name.replace(/\.[^.]+$/, '').replaceAll('_', '-')}`,
  path: `/generated/aouad-campaign/official/${name}`,
  width,
  height,
  usage,
  source_type: 'rights-secured-ip-asset',
  source_url: `https://github.com/icons-hq/icons/blob/${SOURCE_COMMIT}/${SOURCE_ROOT}/${name}`,
  source_commit: SOURCE_COMMIT,
  reference: [SAMPLE_URL],
  provenance: `Copied byte-for-byte from icons-hq/icons@${SOURCE_COMMIT}; no pixel edit.`,
  editing: 'copied-without-pixel-edit',
  license: 'User-confirmed All of Us Are Dead IP asset rights',
  license_status: 'LOCKED-user-confirmed-2026-08-21',
}));

const concepts = [
  ['popup-hub-desktop', 'docs/ip/all-of-us-are-dead-2/concepts/popup-hub-desktop.png', 1536, 1024, 'desktop popup hub approved visual concept', 'builtin-imagegen://01a021d5-de9c-7f60-b018-e650d3224aa3/exec-66dcc5c8-ee67-4097-892d-2c03fcd56b3d.png'],
  ['popup-hub-mobile', 'docs/ip/all-of-us-are-dead-2/concepts/popup-hub-mobile.png', 853, 1844, '390px-first popup hub approved visual concept', 'builtin-imagegen://01a021d5-de9c-7f60-b018-e650d3224aa3/exec-562cb75e-882c-4e1d-8d21-3427c6bc9777.png'],
  ['popup-hero-school-night-source', 'docs/ip/all-of-us-are-dead-2/concepts/popup-hero-school-night-source.png', 1672, 941, 'campaign night-school hero master', 'builtin-imagegen://01a021d5-de9c-7f60-b018-e650d3224aa3/exec-05c86ceb-cf90-4860-b76e-f63a6b0a02db.png'],
  ['popup-broadcast-source', 'docs/ip/all-of-us-are-dead-2/concepts/popup-broadcast-source.png', 1672, 941, 'broadcast-room campaign plate master', 'builtin-imagegen://01a022fa-db4b-7f01-8221-5f7ced2642d5/exec-4366aceb-da38-4dde-ab19-7f2dc18ec32b.png'],
  ['popup-rooftop-source', 'docs/ip/all-of-us-are-dead-2/concepts/popup-rooftop-source.png', 1536, 1024, 'rooftop survival-record plate master', 'builtin-imagegen://01a022fa-db4b-7f01-8221-5f7ced2642d5/exec-ef577d51-0aaf-4c42-84c3-f8ed31b47ce2.png'],
].map(([id, path, width, height, usage, sourceUrl]) => imageAsset({
  id: `campaign-concept-${id}`,
  path,
  width,
  height,
  usage,
  source_type: 'generated-campaign-concept',
  source_url: sourceUrl,
  reference: [SAMPLE_URL, 'docs/ip/all-of-us-are-dead-2/concepts/popup-hub-desktop.png'],
  provenance: 'Built-in image generation; art direction and review by gpt-5.6-sol max; original PNG preserved.',
  editing: 'original-generation-output',
  license: 'ICONS-project-generated-under-confirmed-IP-rights',
  license_status: 'LOCKED-user-confirmed-2026-08-21',
}));

const runtimeImages = [
  ['hero-school-night', '/generated/aouad-campaign/generated/hero-school-night.webp', 1672, 941, 'popup hub hero and campaign entry backdrop', 'popup-hero-school-night-source', 'cwebp 1.6.0 q84 m6'],
  ['broadcast-room', '/generated/aouad-campaign/generated/sol/reunion-radio-room-opening.webp', 1672, 941, 'broadcast zone hero with responsive overlay safe area', 'popup-broadcast-source', 'cwebp 1.6.0 q86 m6 sharp_yuv'],
  ['rooftop-record', '/generated/aouad-campaign/generated/sol/rooftop-survival-record.webp', 1536, 1024, 'rooftop zone and personal survival-record backdrop', 'popup-rooftop-source', 'cwebp 1.6.0 q86 m6 sharp_yuv'],
].map(([id, path, width, height, usage, sourceId, conversion]) => imageAsset({
  id: `campaign-runtime-${id}`,
  path,
  width,
  height,
  usage,
  source_type: 'generated-runtime-plate',
  source_url: `manifest://${sourceId}`,
  reference: [SAMPLE_URL],
  provenance: `Generated PNG master converted to WebP with ${conversion}.`,
  editing: 'lossy-webp-runtime-derivative',
  license: 'ICONS-project-generated-under-confirmed-IP-rights',
  license_status: 'LOCKED-user-confirmed-2026-08-21',
}));

const audio = [
  ['radio-static-bed', 2.4, 'broadcast-room radio static ambience', 'seeded-4041-7319'],
  ['rooftop-wind-bed', 4.2, 'rooftop zone wind ambience', 'seeded-1984-6027'],
  ['radio-response-confirm', 0.82, 'broadcast response interaction confirmation', 'unseeded-canonical-hash'],
  ['survivor-record-stamp', 0.34, 'survival-record seal confirmation', 'unseeded-canonical-hash'],
  ['campaign-zone-unlock', 0.985, 'local campaign zone completion confirmation', 'unseeded-canonical-hash'],
].map(([id, durationSeconds, usage, reproducibility]) => audioAsset({
  id: `campaign-audio-${id}`,
  path: `/generated/aouad-campaign/generated/sol/${id}.wav`,
  duration_seconds: durationSeconds,
  usage,
  source_type: 'procedural-audio',
  source_url: `ffmpeg-lavfi://self-generated/${reproducibility}/${id}`,
  reference: [SAMPLE_URL],
  provenance: reproducibility.startsWith('seeded-')
    ? `Original deterministic FFmpeg sine/noise synthesis (${reproducibility}); no external sample.`
    : 'Original FFmpeg sine/noise synthesis with unseeded noise; recorded SHA-256 is canonical and exact reruns may differ; no external sample.',
  reproducibility,
  editing: 'original-procedural-synthesis',
  license: 'ICONS-original-procedural-audio',
  license_status: 'project-original-no-external-samples',
}));

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const existing = manifest.assets
  .filter((asset) => !asset.id.startsWith('campaign-'))
  .map((asset) => {
    const lockedSource = asset.source_type === 'rights-secured-ip-asset'
      ? {
          ...asset,
          source_url: asset.source_url.replace('/blob/main/', `/blob/${SOURCE_COMMIT}/`),
          source_commit: SOURCE_COMMIT,
          provenance: asset.provenance.replace('icons-hq/icons@main', `icons-hq/icons@${SOURCE_COMMIT}`),
        }
      : asset;
    return {
      ...lockedSource,
      editing: lockedSource.editing ?? (
        lockedSource.source_type === 'procedural-audio' ? 'original-procedural-synthesis'
          : lockedSource.source_type === 'rights-secured-ip-asset' && lockedSource.path.endsWith('.png') ? 'copied-without-pixel-edit'
            : lockedSource.source_type === 'rights-secured-ip-asset' ? 'converted-to-webp'
              : lockedSource.source_type?.startsWith('derived-') ? 'derived-and-converted'
                : lockedSource.path.endsWith('.png') ? 'original-generation-output'
                  : 'generated-and-converted'
      ),
    };
  });

manifest.generated_at = '2026-08-21';
manifest.rights_confirmation = {
  ...manifest.rights_confirmation,
  status: 'LOCKED',
  seasons: ['season-1', 'season-2'],
  scope: 'All of Us Are Dead seasons 1 and 2 IP, supplied AOUAD image assets, interactive production, merchandise production and sales rights',
};
manifest.source_lock = {
  repository: 'icons-hq/icons',
  commit: SOURCE_COMMIT,
  sample_url: SAMPLE_URL,
  source_directory: SOURCE_ROOT,
  external_runtime_dependency: false,
};
manifest.assets = [...existing, ...concepts, ...runtimeImages, ...audio, ...official];

const ids = new Set();
const paths = new Set();
for (const asset of manifest.assets) {
  if (ids.has(asset.id)) throw new Error(`Duplicate asset id: ${asset.id}`);
  if (paths.has(asset.path)) throw new Error(`Duplicate asset path: ${asset.path}`);
  ids.add(asset.id);
  paths.add(asset.path);
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${MANIFEST_PATH} with ${manifest.assets.length} assets.`);
