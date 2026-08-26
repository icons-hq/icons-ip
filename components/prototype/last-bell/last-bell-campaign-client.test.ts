import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientSource = readFileSync(new URL('./LastBellCampaignClient.tsx', import.meta.url), 'utf8');
const endingSource = readFileSync(new URL('./RooftopEndingOverlay.tsx', import.meta.url), 'utf8');

describe('Last Bell campaign ending UI contract', () => {
  it('keeps a touch-completable, no-commerce rooftop approach after normal HUD is hidden', () => {
    expect(clientSource).toContain("snapshot.rooftopPhase === 'approach'");
    expect(clientSource).toContain('styles.cinematicTouchControls');
    expect(clientSource).toContain('styles.cinematicWalkButton');
    expect(clientSource).toContain('setTouchMove({ x: 0, y: 1 })');
    expect(clientSource).toContain('styles.cinematicLookPad');
    expect(clientSource).toContain("interaction?.id !== 'ch2.namra' || !interaction.enabled");
    expect(clientSource).toContain('!contextLost && !inventoryOpen');
    expect(clientSource).toContain('setListening(false);');
    expect(clientSource).toContain('setCrouching(false);');
    expect(clientSource).toContain('runRef.current = false;');
    expect(clientSource).toContain("!hideHud && started ? (");
    expect(clientSource).toContain("!hideHud && toastItem ? (");
  });

  it('keeps inventory and store actions out of the ending until the completed black result surface', () => {
    expect(clientSource).toContain('open={inventoryOpen && (!hideHud || snapshot.gameComplete)}');
    expect(clientSource).toContain("event.code === 'Tab' && started && entryPhase === 'playing' && !hideHud");
    expect(endingSource).toContain("const resultReady = phase === 'black' && gameComplete;");
    expect(endingSource).toContain('{resultReady ? (');
    expect(endingSource).toContain('onOpenInventory');
    expect(endingSource).toContain('보급소로 돌아가기');
  });

  it('routes every infection cue through visible copy and one-shot audio, not snapshot state alone', () => {
    expect(clientSource).toContain('LAST_BELL_FORESHADOWING_CUES');
    expect(clientSource).toContain("if (event.type === 'foreshadowing')");
    expect(clientSource).toContain('setForeshadowingCue(event.cue)');
    expect(clientSource).toContain('playOneShot(cue.audio, cue.volume)');
    expect(clientSource).toContain('styles.campaignForeshadowing');
  });

  it('keeps C as mobile/keyboard crouch while authored E interactions alone enter locker cover', () => {
    expect(clientSource).toContain("if (event.code === 'KeyC') setCrouching((value) => !value);");
    expect(clientSource).toContain('onClick={() => setCrouching((value) => !value)}>C</button>');
    expect(clientSource).not.toContain("if (event.code === 'KeyC') setHiding");
    expect(clientSource).toContain('E 상호작용');
    expect(clientSource).toContain('C 웅크리기');
    expect(clientSource).toContain('function gamepadInput()');
    expect(clientSource).toContain('navigator.getGamepads');
    expect(clientSource).toContain('snapshot.player.stealthState');
    expect(clientSource).toContain('LAST_BELL_GAMEPLAY_AUDIO.hiddenBreath');
    expect(clientSource).toContain('LAST_BELL_GAMEPLAY_AUDIO.hideCloth');
  });

  it('keeps both required phone orientations on the shared touch-input path', () => {
    expect(clientSource).toContain('shouldUseLastBellTouchHud({');
    expect(clientSource).toContain('width: window.innerWidth');
    expect(clientSource).toContain('height: window.innerHeight');
  });

  it('holds cold-open skip pending until the environment is actually mounted and clears all input latches', () => {
    expect(clientSource).toContain('const [skipPending, setSkipPending] = useState(false);');
    expect(clientSource).toContain('const skipOpening = useCallback');
    expect(clientSource).toContain('if (sceneReady && !starting) completeOpeningHandoff();');
    expect(clientSource).toContain('if (!skipPending || !sceneReady || starting) return;');
    expect(clientSource).toContain('setOpeningHandoffNonce((value) => value + 1);');
    expect(clientSource).toContain('openingHandoffNonce={openingHandoffNonce}');
    expect(clientSource).toContain('const resetInputLatches = useCallback');
    expect(clientSource).toContain('pressedRef.current.clear();');
    expect(clientSource).toContain('lookRef.current = { x: 0, y: 0 };');
    expect(clientSource).not.toContain('onSceneReady={() => setSceneReady(true)}');
    expect(clientSource).toContain('onSkip={skipOpening}');
    expect(clientSource).toContain('sceneReady={sceneReady && !starting}');
    expect(clientSource).toContain('onSceneReady={handleSceneReady}');
    expect(clientSource).toContain('entryQaTimesRef.current.sceneReadyAtMs ??= performance.now()');
    expect(clientSource).toContain('entryQaTimesRef.current.activationRequestedAtMs = performance.now()');
    expect(clientSource).toContain("interaction?.id === 'ch1.classroom-door.open'");
    expect(clientSource).toContain('readyToDoorMs:');
  });

  it('clears held movement before the capture retry nonce can rehydrate the first-bay checkpoint', () => {
    expect(clientSource).toContain('const retryFromCapture = useCallback');
    expect(clientSource).toContain('resetInputLatches();');
    expect(clientSource).toContain('onClick={retryFromCapture}>다시 일어나기');
  });

  it('keeps an opening-GLB failure fail-closed until the existing retry CTA reloads authored assets', () => {
    expect(clientSource).toContain('const [openingAssetStatus, setOpeningAssetStatus]');
    expect(clientSource).toContain('openingAssetStatus.criticalAssetFailure || routeAssetStatus.criticalAssetFailure');
    expect(clientSource).toContain('onOpeningAssetStatus={onOpeningAssetStatus}');
    expect(clientSource).toContain('setAssetRetryNonce((value) => value + 1)');
    expect(clientSource).toContain('!assetStatus.criticalAssetFailure');
  });
});
