#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [catalogArg, reportArg, destinationArg, releaseModeArg = 'stage', reviewEvidenceArg] = process.argv.slice(2);
if (!catalogArg || !reportArg || !destinationArg) throw new Error('usage: update-manifest.mjs <catalog.json> <validation.json> <destination.json>');
if (!['stage', 'public', 'public-in-game'].includes(releaseModeArg)) throw new Error(`Unknown release mode: ${releaseModeArg}`);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const report = JSON.parse(await readFile(resolve(reportArg), 'utf8'));
const productReports = new Map(report.products.map((product) => [product.key, product]));
const sha256 = (input) => createHash('sha256').update(input).digest('hex');
const isSalesRelease = releaseModeArg === 'public';
const isPublicInGameDelivery = releaseModeArg === 'public-in-game';
const isPublicDelivery = isSalesRelease || isPublicInGameDelivery;
const deliveryRoot = isPublicDelivery
  ? 'public/generated/last-bell/products'
  : 'outputs/last-bell-product-assets/delivery-stage';
let releaseEvidence;
if (isPublicDelivery) {
  if (!reviewEvidenceArg) {
    throw new Error('Public manifest requires an approval evidence JSON path.');
  }
  const bytes = await readFile(resolve(reviewEvidenceArg));
  const evidence = JSON.parse(bytes.toString('utf8'));
  if (evidence.schema !== 1) throw new Error('Approval evidence schema must be 1.');
  if (evidence.delivery_build_id !== report.build_id) {
    throw new Error(`Approval evidence build mismatch: expected ${report.build_id}, received ${evidence.delivery_build_id ?? 'missing'}.`);
  }
  if (isSalesRelease) {
    if (evidence.visual_review?.status !== 'approved') {
      throw new Error('Approval evidence does not contain an approved visual review.');
    }
    if (evidence.ip_and_manufacturing_review?.status !== 'approved') {
      throw new Error('Approval evidence does not contain approved IP and manufacturing review.');
    }
    releaseEvidence = {
      sha256: sha256(bytes),
      delivery_build_id: evidence.delivery_build_id,
      visual_review: 'approved',
      ip_and_manufacturing_review: 'approved',
    };
  } else {
    if (evidence.visual_review?.status !== 'approved-for-in-game-delivery') {
      throw new Error('In-game delivery evidence does not contain the requested visual approval.');
    }
    if (evidence.ip_and_manufacturing_review?.status !== 'p1-pending') {
      throw new Error('In-game delivery evidence must keep IP and manufacturing at P1 pending.');
    }
    if (evidence.sales_activation?.status !== 'disabled') {
      throw new Error('In-game delivery evidence must keep sales activation disabled.');
    }
    releaseEvidence = {
      sha256: sha256(bytes),
      delivery_build_id: evidence.delivery_build_id,
      visual_review: 'approved-for-in-game-delivery',
      ip_and_manufacturing_review: 'p1-pending',
      sales_activation: 'disabled',
    };
  }
}

const manifest = {
  schema: 1,
  build_id: report.build_id,
  source_of_truth: 'scripts/last-bell-products/catalog.json',
  material_provenance: {
    source: 'outputs/last-bell-3d/raw/polyhaven-pbr/provenance.json',
    license: 'CC0-1.0',
    delivery: 'KTX2 base-color, normal, and ORM maps are embedded in each delivery GLB',
  },
  review_status: {
    automated_asset_contract: 'pass',
    visual_lookdev: isSalesRelease
      ? 'human-review-asserted-for-release'
      : isPublicInGameDelivery
        ? 'root-review-approved-for-in-game-delivery'
        : 'blocked-human-art-review-required',
    ip_and_manufacturing: isSalesRelease
      ? 'approved-for-matching-build'
      : isPublicInGameDelivery
        ? 'p1-final-graphics-and-manufacturing-pending'
        : 'pending-required-before-sales-activation',
    sales_activation: isSalesRelease ? 'eligible-after-approved-release' : 'disabled-pending-ip-and-manufacturing-review',
    character_delivery: 'replaceable non-likeness character seam; likeness approval is not asserted',
  },
  release_status: isSalesRelease
    ? {
        status: 'approved-release-candidate',
        guard: 'scripts/last-bell-products/release-guard.mjs',
        automated_contract_build: report.build_id,
        approval_evidence: releaseEvidence,
      }
    : isPublicInGameDelivery
      ? {
          status: 'public-in-game-delivery-approved-p1',
          scope: 'in-game-collectibles-only; not a sales or manufacturing release',
          sales_activation: 'disabled',
          guard: 'scripts/last-bell-products/release-guard.mjs',
          automated_contract_build: report.build_id,
          review_evidence: releaseEvidence,
        }
    : {
        status: 'blocked',
        reason: 'Delivery GLBs passed automated PBR/UV/runtime checks, but human visual review has not approved public promotion.',
        guard: 'scripts/last-bell-products/release-guard.mjs',
        automated_contract_build: report.build_id,
      },
  constraints: catalog.lookdev_generation.common_constraints,
  products: await Promise.all(catalog.products.map(async (product) => {
    const result = productReports.get(product.key);
    if (!result) throw new Error(`Missing validator record for ${product.key}`);
    return {
      key: product.key,
      display_name: product.display_name,
      chapter: product.chapter,
      placement: product.placement,
      path_kind: product.path_kind,
      semantic_anchor: product.anchor,
      collision_m: product.collision_m,
      delivery: {
        status: isSalesRelease
          ? 'public-release-candidate'
          : isPublicInGameDelivery
            ? 'public-in-game-delivery-p1-sales-disabled'
            : 'private-stage-not-for-runtime-release',
        model: `${deliveryRoot}/${product.key}/model.glb`,
        thumbnail: `${deliveryRoot}/${product.key}/thumbnail.webp`,
        graphic_layer: `${deliveryRoot}/${product.key}/graphic-layer.svg`,
        model_sha256: result.model.sha256,
        thumbnail_sha256: result.thumbnail.sha256,
        graphic_layer_sha256: result.graphic_layer.sha256,
        model_bytes: result.model.bytes,
        texture_encoding: result.model.texture_encoding,
        thumbnail_bytes: result.thumbnail.bytes,
        thumbnail_render_source: result.thumbnail.source,
      },
      provenance: {
        authoring: 'Blender 5.2 original geometry + CC0 KTX2 PBR texture maps, UV0, UV1, and semantic delivery nodes',
        source_lookdev: product.lookdev,
        source_sha256: sha256(await readFile(resolve(product.lookdev))),
        source_generation: catalog.lookdev_generation.tool,
        prompt: product.prompt,
        derivative_sha256: result.model.sha256,
        source_pixels_embedded: false,
        text_baked: false,
      },
    };
  })),
  character_seams: 'docs/ip/all-of-us-are-dead-2/last-bell-character-asset-seams.json',
};
await writeFile(resolve(destinationArg), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ build_id: manifest.build_id, products: manifest.products.length }, null, 2));
