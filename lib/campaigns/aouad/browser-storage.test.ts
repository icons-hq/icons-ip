import { describe, expect, it } from 'vitest';
import { getOptionalStorage } from './browser-storage';

describe('getOptionalStorage', () => {
  it('returns the storage implementation when the browser exposes it', () => {
    const storage = { getItem: () => null } as unknown as Storage;

    expect(getOptionalStorage({ localStorage: storage })).toBe(storage);
  });

  it('treats a SecurityError from the localStorage getter as unavailable storage', () => {
    const host = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    }) as { localStorage: Storage };

    expect(getOptionalStorage(host)).toBeNull();
  });
});
