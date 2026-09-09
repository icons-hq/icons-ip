export const PRNG_ALGORITHM_VERSION = 'xorshift32-v1' as const;

function hashNamespace(seed: string, namespace: string): number {
  const source = `${seed}\u0000${namespace}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 0x9e3779b9;
}

export interface NamespacedRng {
  nextInt(maxExclusive: number): number;
  nextFloat(): number;
  state(): number;
}

/** A small replay-stable PRNG. Each subsystem receives its own namespace. */
export function createNamespacedRng(seed: string, namespace: string): NamespacedRng {
  let current = hashNamespace(seed, namespace);
  const nextUint = () => {
    current ^= current << 13;
    current ^= current >>> 17;
    current ^= current << 5;
    current >>>= 0;
    return current;
  };
  return {
    nextInt(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
      return nextUint() % maxExclusive;
    },
    nextFloat() {
      return nextUint() / 4_294_967_296;
    },
    state() {
      return current;
    },
  };
}
