import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./FlashlightRig.tsx', import.meta.url), 'utf8');

describe('Last Bell flashlight rig', () => {
  it('keeps the narrow shadowed beam while adding the approved broad near-field fill', () => {
    expect(source).toContain('new THREE.SpotLight');
    expect(source.match(/new THREE\.SpotLight/g)).toHaveLength(2);
    expect(source).toContain('outerFillIntensity: 20');
    expect(source).toContain('outerFillDistance: 8.5');
    expect(source).toContain('outerFillAngleDegrees: 68');
    expect(source).toContain('nearBounceIntensity: 88');
    expect(source).toContain('nearBounceDistance: 5.8');
    expect(source).toContain('centralIntensity: 72');
    expect(source).toContain('sideBounceIntensity: .85');
    expect(source).toContain('sideBounceDistance: 4.8');
    expect(source).toContain('sideBounceOffset: 1.1');
    expect(source).toContain('outerFill.castShadow = false');
    expect(source).toContain('outerFill.visible = on');
    expect(source).toContain('ambientIntensity: .48');
    expect(source).toContain('hemisphereIntensity: 1');
    expect(source).toContain("new THREE.AmbientLight('#345a5b', LAST_BELL_FLASHLIGHT_PROFILE.ambientIntensity)");
    expect(source).toContain('new THREE.HemisphereLight');
    expect(source).toContain('light.castShadow = true');
    expect(source).toContain('outerFill.dispose()');
    expect(source).toContain('nearBounce.dispose()');
    expect(source).toContain('leftBounce.dispose()');
    expect(source).toContain('rightBounce.dispose()');
    expect(source).toContain('ambient.dispose()');
    expect(source).toContain('hemisphere.dispose()');
  });
});
