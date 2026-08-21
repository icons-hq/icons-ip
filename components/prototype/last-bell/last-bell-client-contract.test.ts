import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientSource = readFileSync(new URL('./LastBellClient.tsx', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('./LastBellRuntime.tsx', import.meta.url), 'utf8');

describe('last bell runtime/client contracts', () => {
  it('uses the typed interaction registry and opening preload hint', () => {
    expect(clientSource).toContain('INTERACTION_DESCRIPTORS.map');
    expect(clientSource).toContain('interactionDescriptorFor(nearestRef.current)?.action');
    expect(clientSource).not.toContain('INTERACTION_COPY');
    expect(clientSource).not.toContain('ACTION_AUDIO');
    expect(clientSource).toContain('preload sizes="100vw"');
  });

  it('keeps keyboard actions stable while reading the latest nearest descriptor ref', () => {
    expect(clientSource).toContain('const nearestRef = useRef<LastBellInteractionAnchor | null>(null);');
    expect(clientSource).toContain('const setNearestValue = useCallback');
    expect(clientSource).toContain('nearestRef.current = next;');
    expect(clientSource).toContain('interactionDescriptorFor(nearestRef.current)');
    expect(clientSource).toContain('const prompt = interactionDescriptorFor(nearest)?.copy ?? null;');
    expect(clientSource).toContain('}, [interact, toggleHide, toggleListen]);');
    expect(clientSource).not.toContain('}, [interact, state.phase, toggleHide, toggleListen]);');
  });

  it('uses one primary action for every modal Escape path', () => {
    expect(clientSource).toContain("if (event.key === 'Escape')");
    expect(clientSource).toContain('modalPrimaryAction();');
    expect(clientSource).toContain('onClick={modalPrimaryAction}');
    expect(clientSource).toContain("if (activeModal === 'paused') setPaused(false)");
    expect(clientSource).toContain("else if (activeModal === 'captured') retryFromCheckpoint()");
    expect(clientSource).toContain("else if (activeModal === 'complete') restartFromComplete()");
  });

  it('persists the Last Bell result into the shared comparison contract and renders common result actions', () => {
    expect(clientSource).toContain('comparisonResultFromLastBell');
    expect(clientSource).toContain('saveAouadComparisonResult(storage, comparisonResult)');
    expect(clientSource).toContain('<ComparisonResultActions');
    expect(clientSource).toContain('primaryActionRef={modalPrimaryRef}');
  });

  it('uses the optional browser-storage seam for all local progress reads and writes', () => {
    expect(clientSource).toContain("import { getOptionalStorage } from '@/lib/campaigns/aouad/browser-storage'");
    expect(clientSource).toContain('const storage = getOptionalStorage();');
    expect(clientSource).not.toContain('window.localStorage');
  });

  it('uses the shared approved route label registry in completion UI', () => {
    expect(clientSource).toContain("import { LAST_BELL_ROUTE_LABELS } from '@/lib/prototypes/last-bell/routes'");
    expect(clientSource).toContain('LAST_BELL_ROUTE_LABELS[completionRecord.routeId]');
    expect(clientSource).not.toContain("systems: '설비실 안내선'");
  });

  it('tracks active wall time separately from fixed simulation steps and excludes inactive presentation states', () => {
    expect(clientSource).toContain('const onActiveTime = useCallback');
    expect(clientSource).toContain('!paused && !portrait && !showOpening && !state.captured');
    expect(runtimeSource).toContain('stepLastBellActivityClock');
    expect(runtimeSource).toContain('onActiveTime(activityFrame.activeDurationMs)');
  });

  it('routes canvas interaction through a rejection-safe pointer lock helper', () => {
    expect(clientSource).toContain('requestLastBellPointerLock(canvas)');
    expect(clientSource).not.toContain('canvas.requestPointerLock?.()');
  });

  it('keeps closed door leaves, atomic handoff, and fixed-step capture separate from danger sampling', () => {
    expect(runtimeSource).not.toContain('locked ? 1.55');
    expect(runtimeSource).toContain('handoff: LastBellDoorHandoffCommand | null');
    expect(runtimeSource).toContain('previousPosition');
    expect(runtimeSource).toContain('captureReportedRef');
    expect(runtimeSource).toContain('captureReportedRef.current = false');
    expect(runtimeSource).toContain('onCapture();');
  });
});
