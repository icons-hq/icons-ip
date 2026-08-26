import { describe, expect, it } from 'vitest';
import {
  assertLastBellEnvironmentVisualQuality,
  evaluateLastBellEnvironmentVisualQuality,
  LAST_BELL_AUTOMATED_VISUAL_PASS,
  LAST_BELL_VISUAL_QUALITY_SCOPE,
} from './visual-quality.mjs';

const referenceMetrics = {
  corridor: {
    floor: { row_mean_jump_max: 6.2, edge_density: .11 },
  },
  rooftop: {
    rooftop_sky: { luma_stdev: 3.1, mean_horizontal_gradient: .36 },
    rooftop_edge_mismatch: { max: .88 },
  },
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    corridor: {
      floor: { row_mean_jump_max: 4.4, edge_density: .13 },
    },
    rooftop: {
      rooftop_sky: { luma_stdev: 2.1, mean_horizontal_gradient: .18 },
      rooftop_edge_mismatch: { max: .9 },
      rooftop_headhouse: { edge_density: .082 },
    },
    references: referenceMetrics,
    ...overrides,
  };
}

describe('Last Bell generated-reference environment visual-quality gate', () => {
  it('accepts a detailed delivery frame without banding or matte seams', () => {
    const evaluation = evaluateLastBellEnvironmentVisualQuality(candidate());
    expect(evaluation.status).toBe(LAST_BELL_AUTOMATED_VISUAL_PASS);
    expect(() => assertLastBellEnvironmentVisualQuality(evaluation)).not.toThrow();
  });

  it('rejects corridor floor banding that exceeds the generated lookdev tolerance', () => {
    const input = candidate();
    input.corridor.floor.row_mean_jump_max = 8.2;
    const evaluation = evaluateLastBellEnvironmentVisualQuality(input);
    expect(() => assertLastBellEnvironmentVisualQuality(evaluation)).toThrow('corridor-floor-horizontal-band-limit');
  });

  it('rejects an empty rooftop sky even when the image has unrelated scene contrast', () => {
    const input = candidate();
    input.rooftop.rooftop_sky = { luma_stdev: 0, mean_horizontal_gradient: 0 };
    const evaluation = evaluateLastBellEnvironmentVisualQuality(input);
    expect(() => assertLastBellEnvironmentVisualQuality(evaluation)).toThrow('rooftop-matte-tonal-variation');
  });

  it('rejects a visible outer matte boundary', () => {
    const input = candidate();
    input.rooftop.rooftop_edge_mismatch.max = 2.9;
    const evaluation = evaluateLastBellEnvironmentVisualQuality(input);
    expect(() => assertLastBellEnvironmentVisualQuality(evaluation)).toThrow('rooftop-matte-edge-seam');
  });

  it('rejects the clean-box headhouse regression', () => {
    const input = candidate();
    input.rooftop.rooftop_headhouse.edge_density = .06;
    const evaluation = evaluateLastBellEnvironmentVisualQuality(input);
    expect(() => assertLastBellEnvironmentVisualQuality(evaluation)).toThrow('rooftop-headhouse-authored-detail');
  });

  it('keeps an automated environment pass narrower than release approval', () => {
    expect(LAST_BELL_VISUAL_QUALITY_SCOPE).toBe('private-route-environment-only');
    expect(LAST_BELL_AUTOMATED_VISUAL_PASS).not.toContain('human');
    expect(LAST_BELL_AUTOMATED_VISUAL_PASS).not.toContain('release');
  });
});
