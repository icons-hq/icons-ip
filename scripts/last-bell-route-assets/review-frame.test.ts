import { describe, expect, it } from 'vitest';
import { assertLastBellReviewFrameMetrics } from './review-frame.mjs';

describe('Last Bell visual-review frame validator', () => {
  it('rejects a technically valid PNG-sized uniform frame', () => {
    expect(() => assertLastBellReviewFrameMetrics({ mean_channel_stdev: .49, channel_range: 1 }, 'corridor')).toThrow('visually empty or uniform');
  });

  it('accepts a frame with scene contrast and tonal range', () => {
    expect(() => assertLastBellReviewFrameMetrics({ mean_channel_stdev: 18.2, channel_range: 178 }, 'corridor')).not.toThrow();
  });
});
