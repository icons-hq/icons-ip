import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./LastBellCampaignRuntime.tsx', import.meta.url), 'utf8');
const chapterOneSource = readFileSync(new URL('./scene/ChapterOneScene.tsx', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('./scene/AuthoredEnvironment3d.tsx', import.meta.url), 'utf8');

describe('Last Bell campaign runtime contracts', () => {
  it('publishes physical door occupancy for checkpoint/retry QA instead of only a visual door state', () => {
    expect(source).toContain('occupants: [...door.occupants]');
    expect(source).toContain("id: door.id,");
    expect(source).toContain("passable: door.passable,");
  });

  it('applies the mounted opening handoff inside the simulation before the first playable interaction', () => {
    expect(source).toContain('openingHandoffNonce: number;');
    expect(source).toContain('simulationRef.current.prepareOpeningDoorInteraction()');
    expect(source).toContain('checkpointId: snapshot.checkpointId');
    expect(source).toContain('captured: snapshot.captured');
    expect(source).toContain('availableInteractions: snapshot.availableInteractions.map');
    expect(source).toContain('lastOpeningHandoffNonceRef');
  });

  it('rehydrates and reports the same retry checkpoint through the retry-nonce effect', () => {
    expect(source).toContain('simulationRef.current.retryFrameFromCheckpoint()');
    expect(source).toContain('for (const event of retry.events) onEventRef.current(event, retry.snapshot);');
  });

  it('uses the simulation hiding spot camera pose and bounded yaw rather than a boolean-only lowered camera', () => {
    expect(source).toContain('hidingSpotById');
    expect(source).toContain('clampFacingAround');
    expect(source).toContain('coverSpot.camera.yawLimitRadians');
    expect(source).toContain('hidingSpot.camera.eyeHeightMeters');
    expect(source).toContain('camera.suppressFlashlight');
    expect(source).toContain("current.player.stealthState === 'hidden'");
  });

  it('publishes the actual hiding camera and suppressed direct-light state for browser QA', () => {
    expect(source).toContain('cameraPosition: cameraPosition.toArray()');
    expect(source).toContain('crouching: snapshot.player.crouching');
    expect(source).toContain('directFlashlightVisible');
    expect(source).toContain('hidingSuppressed: Boolean(hidingSpot?.camera.suppressFlashlight)');
    expect(source).toContain('sideBounce: {');
    expect(source).toContain('offsetMeters: LAST_BELL_FLASHLIGHT_PROFILE.sideBounceOffset');
  });

  it('passes the same stealth snapshot into the classroom GLB panel adapter', () => {
    expect(source).toContain('playerStealth={snapshot.player}');
    expect(chapterOneSource).toContain('playerStealth={playerStealth}');
    expect(environmentSource).toContain('applyLastBellHidingSpotVisuals(scenes.startRoom, playerStealth)');
    expect(environmentSource).toContain('syncLastBellHidingSpotAnimations(hidingMixer, hidingClips, playerStealth)');
  });

  it('fails a critical opening asset closed and routes the same retry nonce/status seam to the campaign CTA', () => {
    expect(chapterOneSource).not.toContain('fallback={<');
    expect(chapterOneSource).toContain('retryNonce={assetRetryNonce}');
    expect(chapterOneSource).toContain('onAssetStatus={onAssetStatus}');
    expect(source).toContain('onOpeningAssetStatus?: (status: LastBellOpeningAssetStatus) => void;');
    expect(source).toContain('onAssetStatus={props.onOpeningAssetStatus}');
    expect(environmentSource).toContain("failedAssetKeys: ['opening:environment'], criticalAssetFailure: true");
  });
});
