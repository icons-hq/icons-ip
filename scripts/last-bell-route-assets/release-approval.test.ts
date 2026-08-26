import { describe, expect, it } from 'vitest';
import {
  assertLastBellReleaseMetadataApproval,
  containsLastBellForbiddenDeliveryMarker,
  LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
} from './release-approval.mjs';

const approvedReview = {
  status: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
  external_ip_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  evidence: {
    status: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
    external_ip_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
    reviewer_type: 'human',
    reviewer_id: 'human-art-reviewer',
    reviewed_at: '2026-08-26T12:00:00+09:00',
    reviewed_build_id: 'last-bell-route-test',
    p0_findings: 0,
    comparison_renders: [
      { path: 'review/front.png', sha256: 'a'.repeat(64), camera_contract: { camera_id: 'player-camera-front', fov_degrees: 62, exposure: 1, width: 1280, height: 720 } },
      { path: 'review/player-distance.png', sha256: 'b'.repeat(64), camera_contract: { camera_id: 'player-camera-distance', fov_degrees: 62, exposure: 1, width: 1280, height: 720 } },
    ],
  },
};

describe('Last Bell release approval gate', () => {
  it('scans release values without treating the approved no-clay field name as a blocked marker', () => {
    expect(containsLastBellForbiddenDeliveryMarker({ no_clay_primitive_final: true })).toBe(false);
    expect(containsLastBellForbiddenDeliveryMarker({ status: 'technical-mountable-placeholder' })).toBe(true);
    expect(containsLastBellForbiddenDeliveryMarker({ nested: ['approved', { quality: 'procedural fallback' }] })).toBe(true);
  });

  it('does not let an automated asset-contract pass stand in for human visual approval', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: { ...approvedReview, status: 'blocked-human-art-review-required' },
    }, 'character seams')).toThrow('internal visual asset review is not explicitly approved');
  });

  it('does not let a human-art approval bypass external/IP asset approval', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: { ...approvedReview, external_ip_approval: 'not-asserted' },
    }, 'character seams')).toThrow('external/IP asset approval is not explicitly approved');
  });

  it('requires both approved values in the release manifest as well', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      status: {
        internal_visual_asset_review: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
        external_ip_asset_approval: 'not-asserted',
      },
    }, 'release manifest')).toThrow('release manifest external/IP asset approval is not explicitly approved');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: approvedReview,
      status: {
        internal_visual_asset_review: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
        external_ip_asset_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
      },
    }, 'release manifest')).not.toThrow();
  });

  it('does not allow no_clay_primitive_final to replace an approved review surface', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      no_clay_primitive_final: true,
    }, 'unreviewed delivery')).toThrow('no_clay_primitive_final cannot be asserted');

    expect(() => assertLastBellReleaseMetadataApproval({
      no_clay_primitive_final: true,
      visual_review: approvedReview,
    }, 'reviewed delivery')).not.toThrow();
  });

  it('requires a human reviewer, zero P0 findings, and hashed same-camera renders', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: { ...approvedReview.evidence, reviewer_type: 'automated' },
      },
    }, 'automated review')).toThrow('human reviewer');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: { ...approvedReview.evidence, p0_findings: 1 },
      },
    }, 'p0 review')).toThrow('zero P0 findings');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: { ...approvedReview.evidence, comparison_renders: [] },
      },
    }, 'render evidence')).toThrow('comparison render evidence is missing');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: {
          ...approvedReview.evidence,
          comparison_renders: [
            { path: 'review/front.png', sha256: 'not-a-hash' },
            { path: 'review/player-distance.png', sha256: 'b'.repeat(64) },
          ],
        },
      },
    }, 'render hashes')).toThrow('path and sha256');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: { ...approvedReview.evidence, reviewer_id: '' },
      },
    }, 'review identity')).toThrow('identify the human reviewer');

    expect(() => assertLastBellReleaseMetadataApproval({
      visual_review: {
        ...approvedReview,
        evidence: {
          ...approvedReview.evidence,
          comparison_renders: [
            { path: 'review/front.png', sha256: 'a'.repeat(64) },
            approvedReview.evidence.comparison_renders[1],
          ],
        },
      },
    }, 'camera contract')).toThrow('camera, FOV, exposure, and resolution');
  });

  it('does not accept release status strings without the matching review evidence', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      status: {
        internal_visual_asset_review: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
        external_ip_asset_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
      },
    }, 'status-only release')).toThrow('require matching visual review evidence');
  });

  it('allows component manifests whose status contract is a string', () => {
    expect(() => assertLastBellReleaseMetadataApproval({
      status: 'REPLACEABLE_CHARACTER_ART_REVIEW_REQUIRED',
    }, 'component manifest')).not.toThrow();
  });
});
