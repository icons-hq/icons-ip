#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [manifestArg] = process.argv.slice(2);
if (!manifestArg) throw new Error('usage: release-guard.mjs <last-bell-product-asset-manifest.json>');

const manifest = JSON.parse(await readFile(resolve(manifestArg), 'utf8'));
const errors = [];
const forbiddenDeliveryMarkers = /(?:^|[^a-z0-9])(?:placeholder|clay|procedural|fallback|pending[_-]approved[_-]character[_-]replacement|non[_-]likeness[_-]placeholder|technical[_-]mountable[_-]placeholder)(?=$|[^a-z0-9])/i;
if (forbiddenDeliveryMarkers.test(JSON.stringify(manifest))) errors.push('release manifest retains a prohibited delivery-quality marker');
if (manifest.review_status?.automated_asset_contract !== 'pass') errors.push('automated asset contract is not passed');
const isSalesRelease = manifest.release_status?.status === 'approved-release-candidate';
const isPublicInGameDelivery = manifest.release_status?.status === 'public-in-game-delivery-approved-p1';

if (!isSalesRelease && !isPublicInGameDelivery) errors.push(`release status is ${manifest.release_status?.status ?? 'missing'}`);

if (isSalesRelease) {
  if (manifest.review_status?.visual_lookdev !== 'human-review-asserted-for-release') errors.push('human visual review has not approved public promotion');
  if (manifest.review_status?.ip_and_manufacturing !== 'approved-for-matching-build') errors.push('IP and manufacturing review has not approved public promotion');
  if (manifest.review_status?.sales_activation !== 'eligible-after-approved-release') errors.push('sales release lacks an eligible sales activation state');
  if (!/^[a-f0-9]{64}$/.test(manifest.release_status?.approval_evidence?.sha256 ?? '')) errors.push('approval evidence hash is missing');
  if (manifest.release_status?.approval_evidence?.delivery_build_id !== manifest.build_id) errors.push('approval evidence build does not match manifest build');
  if (manifest.release_status?.approval_evidence?.visual_review !== 'approved') errors.push('approval evidence lacks visual approval');
  if (manifest.release_status?.approval_evidence?.ip_and_manufacturing_review !== 'approved') errors.push('approval evidence lacks IP and manufacturing approval');
  if ((manifest.products ?? []).some((product) => product.delivery?.status !== 'public-release-candidate')) errors.push('one or more products are not a public release candidate');
}

if (isPublicInGameDelivery) {
  if (manifest.review_status?.visual_lookdev !== 'root-review-approved-for-in-game-delivery') errors.push('in-game delivery lacks the root visual review');
  if (manifest.review_status?.ip_and_manufacturing !== 'p1-final-graphics-and-manufacturing-pending') errors.push('in-game delivery must retain P1 IP and manufacturing status');
  if (manifest.review_status?.sales_activation !== 'disabled-pending-ip-and-manufacturing-review') errors.push('in-game delivery must retain disabled sales activation');
  if (manifest.release_status?.scope !== 'in-game-collectibles-only; not a sales or manufacturing release') errors.push('in-game delivery scope is not explicit');
  if (manifest.release_status?.sales_activation !== 'disabled') errors.push('in-game delivery release status must keep sales disabled');
  if (!/^[a-f0-9]{64}$/.test(manifest.release_status?.review_evidence?.sha256 ?? '')) errors.push('in-game review evidence hash is missing');
  if (manifest.release_status?.review_evidence?.delivery_build_id !== manifest.build_id) errors.push('in-game review evidence build does not match manifest build');
  if (manifest.release_status?.review_evidence?.visual_review !== 'approved-for-in-game-delivery') errors.push('in-game review evidence lacks visual acceptance');
  if (manifest.release_status?.review_evidence?.ip_and_manufacturing_review !== 'p1-pending') errors.push('in-game review evidence must retain P1 IP and manufacturing status');
  if (manifest.release_status?.review_evidence?.sales_activation !== 'disabled') errors.push('in-game review evidence must retain disabled sales activation');
  if ((manifest.products ?? []).some((product) => product.delivery?.status !== 'public-in-game-delivery-p1-sales-disabled')) errors.push('one or more products are not a public in-game P1 delivery');
}

if (errors.length) throw new Error(`Last Bell product release guard blocked: ${errors.join('; ')}`);
console.log(`Last Bell product release guard passed for ${manifest.build_id}`);
