import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientSource = readFileSync(new URL('./LastBellClient.tsx', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('./LastBellRuntime.tsx', import.meta.url), 'utf8');

describe('last bell runtime/client contracts', () => {
  it('keeps the heavy 3D runtime dynamically loaded without a hidden review interaction seam', () => {
    expect(clientSource).toContain("dynamic(\n  () => import('./LastBellRuntime')");
    expect(clientSource).toContain('INTERACTION_DESCRIPTORS.map');
    expect(clientSource).not.toContain('reviewGate');
    expect(runtimeSource).not.toContain('reviewGate');
    expect(clientSource).toContain('interactionDescriptorFor(nearestRef.current)');
    expect(clientSource).toContain("'classroom_door'");
    expect(clientSource).not.toContain('INTERACTION_COPY');
    expect(clientSource).not.toContain('ACTION_AUDIO');
  });

  it('runs the director from transient animation state instead of the removed 30-second raster timer', () => {
    expect(clientSource).toContain('const entryDirectorRef = useRef(new EntryDirector());');
    expect(clientSource).toContain('window.requestAnimationFrame(advance)');
    expect(clientSource).toContain("dispatch({ type: 'START_PLAY' });");
    expect(clientSource).not.toContain('openingElapsed');
    expect(clientSource).not.toContain('setInterval');
  });

  it('keeps Canvas mounted and drives its entry, lighting, door, and comfort seams by public props', () => {
    expect(clientSource).toContain('entryPhase={entryPhase}');
    expect(clientSource).toContain('flashlightOn={flashlightOn}');
    expect(clientSource).toContain('headBobStrength={reduceMotion ? 0 : headBobStrength}');
    expect(clientSource).toContain('reducedMotion={reduceMotion}');
    expect(clientSource).toContain('doorCommand={doorCommand}');
    expect(clientSource).toContain('onSceneReady={onSceneReady}');
    expect(clientSource).toContain('onDoorStateChange={onDoorStateChange}');
    expect(runtimeSource).toContain('entryPhase?: EntryPhase;');
    expect(runtimeSource).toContain('flashlightOn?: boolean;');
    expect(runtimeSource).toContain('reducedMotion?: boolean;');
  });

  it('requires an actual classroom-door locked callback before the reducer advances', () => {
    expect(clientSource).toContain("requestDoorCommand('classroom', 'open')");
    expect(clientSource).toContain("requestDoorCommand('classroom', 'close-lock')");
    expect(clientSource).toContain("classroomDoorStageRef.current === 'crossed'");
    expect(clientSource).toContain("doorState === 'locked' && classroomDoorStageRef.current === 'locking'");
    expect(clientSource).toContain("dispatch({ type: 'LOCK_CLASSROOM_DOOR' });");
    expect(clientSource).not.toContain("requestDoorHandoff('classroom')");
  });

  it('unlocks audio and tries pointer lock from the entry gesture without making refusal blocking', () => {
    expect(clientSource).toContain('const beginEntry = useCallback');
    expect(clientSource).toContain('audio.unlock();');
    expect(clientSource).toContain('void requestPointerLock();');
    expect(clientSource).toContain('시점을 켜려면 화면을 한 번 클릭하세요.');
    expect(clientSource).toContain('requestLastBellPointerLock(canvas)');
  });

  it('uses touch controls without a desktop pointer-lock prompt in compact landscape', () => {
    expect(clientSource).toContain('function usesTouchGameplayHud()');
    expect(clientSource).toContain("window.matchMedia('(pointer: coarse)').matches");
    expect(clientSource).toContain("window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches");
    expect(clientSource).toContain('if (usesTouchGameplayHud())');
    expect(clientSource).toContain('setPointerLockHint(false);');
    expect(clientSource).toContain('<span className={styles.touchPrompt}>행동</span>');
  });

  it('keeps keyboard handlers gated from the opening while using refs for transient input', () => {
    expect(clientSource).toContain('const gameplayInputEnabledRef = useRef(false);');
    expect(clientSource).toContain('if (modalOpenRef.current || !gameplayInputEnabledRef.current) return;');
    expect(clientSource).toContain("if (key === 'f') toggleFlashlight();");
    expect(clientSource).toContain('moveRef.current');
    expect(clientSource).toContain('lookRef.current');
  });

  it('persists the Last Bell result through optional browser storage and shared comparison actions', () => {
    expect(clientSource).toContain("import { getOptionalStorage } from '@/lib/campaigns/aouad/browser-storage'");
    expect(clientSource).not.toContain('window.localStorage');
    expect(clientSource).toContain('comparisonResultFromLastBell');
    expect(clientSource).toContain('saveAouadComparisonResult(storage, comparisonResult)');
    expect(clientSource).toContain('<ComparisonResultActions');
  });
});
