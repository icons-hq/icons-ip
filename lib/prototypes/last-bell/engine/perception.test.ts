import { describe, expect, it } from 'vitest';
import { createPerception, type PerceptionInput } from './perception';

const directBeam: PerceptionInput = {
  distance: 4,
  beamAngleDegrees: 0,
  directLight: true,
  lineOfSight: true,
  exposureDeltaSeconds: 0,
  noise: 0,
  occlusion: 0,
};

describe('Last Bell perception', () => {
  it('requires a warning and accumulated visible beam exposure before chase', () => {
    const perception = createPerception();

    const warning = perception.observe({ ...directBeam, exposureDeltaSeconds: .1 });
    expect(warning).toMatchObject({ state: 'idle', directLightDetected: true });
    expect(warning.events).toContainEqual({ type: 'light-warning', source: 'light' });

    const investigate = perception.observe({ ...directBeam, exposureDeltaSeconds: .25 });
    expect(investigate).toMatchObject({ state: 'investigate', directLightDetected: true });
    expect(investigate.events).toContainEqual({ type: 'investigate', source: 'light' });

    const chase = perception.observe({ ...directBeam, exposureDeltaSeconds: .6 });
    expect(chase).toMatchObject({ state: 'chase', directLightDetected: true });
    expect(chase.events).toContainEqual({ type: 'chase', source: 'light' });
  });

  it('does not treat a switched-off light or an occluded target as light detection', () => {
    const off = createPerception().observe({ ...directBeam, directLight: false, exposureDeltaSeconds: 2 });
    const behindWall = createPerception().observe({ ...directBeam, lineOfSight: false, occlusion: 1, exposureDeltaSeconds: 2 });

    expect(off).toMatchObject({ state: 'idle', directLightDetected: false, exposureSeconds: 0 });
    expect(behindWall).toMatchObject({ state: 'idle', directLightDetected: false, exposureSeconds: 0 });
  });

  it('keeps noise perception distinct from render shadows and lets contact decay into search', () => {
    const perception = createPerception();
    const noise = perception.observe({ ...directBeam, directLight: false, noise: .8, occlusion: 0, exposureDeltaSeconds: .1 });
    expect(noise).toMatchObject({ state: 'investigate', directLightDetected: false });
    expect(noise.events).toContainEqual({ type: 'investigate', source: 'noise' });

    const search = perception.observe({ ...directBeam, directLight: false, noise: 0, exposureDeltaSeconds: 1.3 });
    expect(search).toMatchObject({ state: 'search', directLightDetected: false });
    expect(search.events).toContainEqual({ type: 'search', source: 'lost-contact' });
  });
});
