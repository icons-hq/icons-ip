import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import { paymentsEnabledForReviewerRuntime } from './config';

export function checkoutPaymentsEnabled(reviewerUserId?: string | null) {
  return getServiceRoleConfig().isConfigured && paymentsEnabledForReviewerRuntime(
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    process.env.TOSS_SECRET_KEY,
    reviewerUserId,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
    process.env.ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION,
    process.env.TOSS_TEST_PAYMENT_REVIEWER_USER_IDS,
  );
}
