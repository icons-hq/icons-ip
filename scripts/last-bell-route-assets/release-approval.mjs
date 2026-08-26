/**
 * Approval values intentionally remain narrower than a successful asset
 * validator. A delivery can be structurally sound while its same-camera
 * character/environment review or external/IP review is still pending.
 */
export const LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL = 'approved-human-art-review';
export const LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL = 'approved-external-ip-review';
const LAST_BELL_FORBIDDEN_DELIVERY_MARKER = /(?:^|[^a-z0-9])(?:placeholder|clay|procedural|fallback|pending[_-]approved[_-]character[_-]replacement|non[_-]likeness[_-]placeholder|technical[_-]mountable[_-]placeholder)(?=$|[^a-z0-9])/i;

export function containsLastBellForbiddenDeliveryMarker(value) {
  if (typeof value === 'string') return LAST_BELL_FORBIDDEN_DELIVERY_MARKER.test(value);
  if (Array.isArray(value)) return value.some(containsLastBellForbiddenDeliveryMarker);
  if (value && typeof value === 'object') return Object.values(value).some(containsLastBellForbiddenDeliveryMarker);
  return false;
}

export function assertLastBellVisualAssetApproval(review, label, expectedBuildId) {
  if (!review || review.status !== LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL) {
    throw new Error(`${label}: internal visual asset review is not explicitly approved`);
  }
  if (review.external_ip_approval !== LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL) {
    throw new Error(`${label}: external/IP asset approval is not explicitly approved`);
  }
  const evidence = review.evidence;
  if (!evidence || evidence.status !== LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL) {
    throw new Error(`${label}: approved internal visual review evidence is missing`);
  }
  if (evidence.external_ip_approval !== LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL) {
    throw new Error(`${label}: approved external/IP evidence is missing`);
  }
  if (evidence.reviewer_type !== 'human') {
    throw new Error(`${label}: visual asset approval must be performed by a human reviewer`);
  }
  if (typeof evidence.reviewer_id !== 'string' || evidence.reviewer_id.trim().length < 3) {
    throw new Error(`${label}: visual asset approval must identify the human reviewer`);
  }
  if (typeof evidence.reviewed_at !== 'string' || Number.isNaN(Date.parse(evidence.reviewed_at))) {
    throw new Error(`${label}: visual asset approval must record a valid review timestamp`);
  }
  if (expectedBuildId && evidence.reviewed_build_id !== expectedBuildId) {
    throw new Error(`${label}: visual asset approval was recorded for a different build`);
  }
  if (evidence.p0_findings !== 0) {
    throw new Error(`${label}: visual asset approval must record zero P0 findings`);
  }
  if (!Array.isArray(evidence.comparison_renders) || evidence.comparison_renders.length < 2) {
    throw new Error(`${label}: same-camera comparison render evidence is missing`);
  }
  for (const render of evidence.comparison_renders) {
    if (!render || typeof render.path !== 'string' || !/^[a-f0-9]{64}$/i.test(render.sha256 ?? '')) {
      throw new Error(`${label}: comparison render evidence must include a path and sha256`);
    }
    const camera = render.camera_contract;
    if (!camera
      || typeof camera.camera_id !== 'string'
      || camera.camera_id.trim().length === 0
      || !Number.isFinite(camera.fov_degrees)
      || !Number.isFinite(camera.exposure)
      || !Number.isInteger(camera.width)
      || !Number.isInteger(camera.height)
      || camera.width < 1
      || camera.height < 1) {
      throw new Error(`${label}: comparison render evidence must record camera, FOV, exposure, and resolution`);
    }
  }
}

export function assertLastBellReleaseMetadataApproval(metadata, label) {
  let approvedReviewSurface = false;
  if (metadata.visual_review) {
    assertLastBellVisualAssetApproval(metadata.visual_review, label);
    approvedReviewSurface = true;
  }

  const status = metadata.status;
  if (status && typeof status === 'object' && 'internal_visual_asset_review' in status && 'external_ip_asset_approval' in status) {
    if (status.internal_visual_asset_review !== LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL) {
      throw new Error(`${label}: release manifest internal visual asset review is not explicitly approved`);
    }
    if (status.external_ip_asset_approval !== LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL) {
      throw new Error(`${label}: release manifest external/IP asset approval is not explicitly approved`);
    }
    if (!metadata.visual_review) {
      throw new Error(`${label}: release manifest approval statuses require matching visual review evidence`);
    }
  }

  if (metadata.no_clay_primitive_final === true && !approvedReviewSurface) {
    throw new Error(`${label}: no_clay_primitive_final cannot be asserted without matching visual and external/IP approval`);
  }
}
