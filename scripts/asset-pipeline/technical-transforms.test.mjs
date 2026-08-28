import { describe, expect, it } from 'vitest';

import {
  applyTechnicalTransform,
  isSupportedTechnicalTransform,
} from './technical-transforms.mjs';

describe('technical transform registry', () => {
  it.each([
    'magenta-matte-to-alpha',
    'magenta-matte-to-alpha-and-regrid',
  ])('publishes the supported transform %s from one registry', (name) => {
    expect(isSupportedTechnicalTransform(name)).toBe(true);
  });

  it('fails closed when execution receives an unsupported transform', async () => {
    expect(isSupportedTechnicalTransform('unknown-transform')).toBe(false);
    await expect(applyTechnicalTransform('unknown-transform', {}))
      .rejects.toThrow('Unsupported technical transform');
  });
});
