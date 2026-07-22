/** @typedef {'test' | 'live'} TossKeyMode */

/**
 * @param {string | null | undefined} value
 * @param {'client' | 'secret'} kind
 * @returns {TossKeyMode | null}
 */
export function paymentKeyMode(value, kind) {
  const suffix = kind === 'client' ? 'gck_' : 'gsk_';
  if (value?.startsWith(`test_${suffix}`)) return 'test';
  if (value?.startsWith(`live_${suffix}`)) return 'live';
  return null;
}

/**
 * @param {string | null | undefined} clientKey
 * @param {string | null | undefined} secretKey
 */
export function paymentKeysMatch(clientKey, secretKey) {
  const clientMode = paymentKeyMode(clientKey, 'client');
  const secretMode = paymentKeyMode(secretKey, 'secret');
  return clientMode !== null && clientMode === secretMode;
}

/**
 * @param {TossKeyMode | null} mode
 * @param {string | null | undefined} allowTestPaymentsInProduction
 */
export function paymentModeEnabledInProduction(mode, allowTestPaymentsInProduction) {
  return mode === 'live'
    || (mode === 'test' && allowTestPaymentsInProduction === 'true');
}
