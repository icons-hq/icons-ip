export type TossKeyMode = 'test' | 'live';

export function paymentKeyMode(
  value: string | null | undefined,
  kind: 'client' | 'secret',
): TossKeyMode | null {
  const suffix = kind === 'client' ? 'gck_' : 'gsk_';
  if (value?.startsWith(`test_${suffix}`)) return 'test';
  if (value?.startsWith(`live_${suffix}`)) return 'live';
  return null;
}

export function paymentKeysMatch(
  clientKey: string | null | undefined,
  secretKey: string | null | undefined,
) {
  const clientMode = paymentKeyMode(clientKey, 'client');
  const secretMode = paymentKeyMode(secretKey, 'secret');
  return clientMode !== null && clientMode === secretMode;
}

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
