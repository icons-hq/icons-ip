import { paymentKeyMode, paymentKeysMatch, paymentModeEnabledInProduction } from './key-mode.mjs';

export { paymentKeyMode, paymentKeysMatch } from './key-mode.mjs';
export type TossKeyMode = 'test' | 'live';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function productionTestPaymentReviewerAllowed(
  userId: string | null | undefined,
  reviewerUserIds: string | null | undefined,
) {
  if (!userId || !UUID_PATTERN.test(userId)) return false;
  return (reviewerUserIds ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value))
    .includes(userId);
}

export function paymentsEnabledForRuntime(
  clientKey: string | null | undefined,
  secretKey: string | null | undefined,
  vercelEnvironment: string | null | undefined = process.env.VERCEL_ENV,
  nodeEnvironment: string | null | undefined = process.env.NODE_ENV,
  allowTestPaymentsInProduction: string | null | undefined = process.env.ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION,
) {
  if (!paymentKeysMatch(clientKey, secretKey)) return false;
  const knownNonProduction = vercelEnvironment === 'development' || vercelEnvironment === 'preview';
  const productionLike = vercelEnvironment === 'production'
    || (!knownNonProduction && nodeEnvironment === 'production');
  const keyMode = paymentKeyMode(clientKey, 'client');
  return !productionLike || paymentModeEnabledInProduction(keyMode, allowTestPaymentsInProduction);
}

export function paymentsEnabledForReviewerRuntime(
  clientKey: string | null | undefined,
  secretKey: string | null | undefined,
  reviewerUserId: string | null | undefined,
  vercelEnvironment: string | null | undefined = process.env.VERCEL_ENV,
  nodeEnvironment: string | null | undefined = process.env.NODE_ENV,
  allowTestPaymentsInProduction: string | null | undefined = process.env.ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION,
  reviewerUserIds: string | null | undefined = process.env.TOSS_TEST_PAYMENT_REVIEWER_USER_IDS,
) {
  if (!paymentsEnabledForRuntime(
    clientKey,
    secretKey,
    vercelEnvironment,
    nodeEnvironment,
    allowTestPaymentsInProduction,
  )) return false;

  const knownNonProduction = vercelEnvironment === 'development' || vercelEnvironment === 'preview';
  const productionLike = vercelEnvironment === 'production'
    || (!knownNonProduction && nodeEnvironment === 'production');
  if (!productionLike || paymentKeyMode(clientKey, 'client') !== 'test') return true;
  return productionTestPaymentReviewerAllowed(reviewerUserId, reviewerUserIds);
}
