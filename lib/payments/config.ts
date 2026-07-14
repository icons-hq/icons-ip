import { paymentKeyMode, paymentKeysMatch } from './key-mode.mjs';

export { paymentKeyMode, paymentKeysMatch } from './key-mode.mjs';
export type TossKeyMode = 'test' | 'live';

export function paymentsEnabledForRuntime(
  clientKey: string | null | undefined,
  secretKey: string | null | undefined,
  vercelEnvironment: string | null | undefined = process.env.VERCEL_ENV,
  nodeEnvironment: string | null | undefined = process.env.NODE_ENV,
) {
  if (!paymentKeysMatch(clientKey, secretKey)) return false;
  const knownNonProduction = vercelEnvironment === 'development' || vercelEnvironment === 'preview';
  const productionLike = vercelEnvironment === 'production'
    || (!knownNonProduction && nodeEnvironment === 'production');
  return !productionLike || paymentKeyMode(clientKey, 'client') === 'live';
}
